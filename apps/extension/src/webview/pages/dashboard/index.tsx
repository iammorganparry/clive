import type React from "react";
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useMachine } from "@xstate/react";
import type { VSCodeAPI } from "../../services/vscode.js";
import { logger } from "../../services/logger.js";
import { useRpc } from "../../rpc/provider.js";
import type { BranchChangesData } from "./components/branch-changes.js";
import BranchChanges from "./components/branch-changes.js";
import Welcome from "./components/welcome.js";
import { dashboardMachine } from "./machines/dashboard-machine.js";
import type { ProposedTest } from "../../../services/ai-agent/types.js";

interface DashboardPageProps {
  vscode: VSCodeAPI;
  pendingPromises: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  createMessagePromise: (
    vscode: VSCodeAPI,
    command: string,
    expectedResponseCommand: string,
  ) => Promise<unknown>;
}

interface CypressStatusData {
  overallStatus: "installed" | "not_installed" | "partial";
  packages: Array<{
    name: string;
    path: string;
    relativePath: string;
    hasCypressPackage: boolean;
    hasCypressConfig: boolean;
    isConfigured: boolean;
  }>;
  workspaceRoot: string;
}

interface MessageData {
  command: string;
  status?: CypressStatusData;
  changes?: BranchChangesData | null;
  error?: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  vscode,
  pendingPromises,
  createMessagePromise: _createMessagePromise,
}) => {
  logger.component.render("DashboardPage", { vscodeAvailable: !!vscode });
  const queryClient = useQueryClient();

  // Handle incoming messages from extension
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message = event.data as MessageData;
      logger.message.receive(message.command, message);

      // Check if there's a pending promise for this command
      const pending = pendingPromises.get(message.command);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message);
        }
      }

      // Legacy message handlers - these are now handled by RPC hooks
      // Keeping minimal handlers for backward compatibility during migration
      if (message.command === "cypress-status" && message.status) {
        queryClient.setQueryData<CypressStatusData>(
          ["cypress-status"],
          message.status,
        );
      }

      if (
        message.command === "branch-changes-status" &&
        message.changes !== undefined
      ) {
        queryClient.setQueryData<BranchChangesData | null>(
          ["branch-changes"],
          message.changes,
        );
      }
    },
    [queryClient, pendingPromises],
  );

  // Set up message listener
  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [handleMessage]);

  // Get RPC client
  const rpc = useRpc();

  // Query for Cypress status using new RPC API
  const { data: cypressStatus, isLoading } = rpc.status.cypress.useQuery();

  // Query for branch changes using new RPC API
  const {
    data: branchChanges,
    isLoading: branchChangesLoading,
    error: branchChangesError,
    refetch: refetchBranchChanges,
  } = rpc.status.branchChanges.useQuery();

  // Dashboard machine (for future use - currently just tracks data)
  const [, send] = useMachine(dashboardMachine, {
    input: {
      branchChanges: branchChanges ?? null,
      cypressStatus: cypressStatus ?? null,
    },
  });

  // Update machine when data loads
  useEffect(() => {
    if (
      !isLoading &&
      cypressStatus !== undefined &&
      branchChanges !== undefined
    ) {
      send({
        type: "DATA_LOADED",
        branchChanges: branchChanges ?? null,
        cypressStatus: cypressStatus ?? null,
      });
    }
  }, [isLoading, cypressStatus, branchChanges, send]);

  // Preview diff mutation
  const previewDiffMutation = rpc.agents.previewDiff.useMutation();

  // Handler for previewing test diff
  const handlePreviewTestDiff = useCallback(
    (test: ProposedTest) => {
      previewDiffMutation.mutate({
        test: {
          id: test.id,
          targetTestPath: test.targetTestPath,
          proposedContent: test.proposedContent,
          existingContent: test.existingContent,
          isUpdate: test.isUpdate,
        },
      });
    },
    [previewDiffMutation],
  );

  // Handler for viewing test file
  const handleViewTest = useCallback(
    (testFilePath: string) => {
      vscode.postMessage({
        command: "open-file",
        filePath: testFilePath,
      });
    },
    [vscode],
  );

  // Handler for refreshing branch changes
  const handleRefreshBranchChanges = useCallback(async () => {
    await refetchBranchChanges();
  }, [refetchBranchChanges]);

  if (isLoading && !cypressStatus) {
    return <Welcome />;
  }

  if (!cypressStatus) {
    return <Welcome />;
  }

  return (
    <div className="w-full h-full">
      <BranchChanges
        changes={branchChanges ?? null}
        isLoading={branchChangesLoading}
        error={branchChangesError?.message}
        vscode={vscode}
        onViewTest={handleViewTest}
        onPreviewDiff={handlePreviewTestDiff}
        onRefresh={handleRefreshBranchChanges}
      />
    </div>
  );
};
