import type React from "react";
import { useCallback, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VSCodeAPI } from "../../services/vscode.js";
import { WebviewMessages } from "../../../constants.js";
import { logger } from "../../services/logger.js";
import type { BranchChangesData } from "./components/branch-changes.js";
import type {
  ProposedTest,
  TestExecutionStatus,
} from "../../../services/ai-agent/types.js";
import BranchChanges from "./components/branch-changes.js";
import TestGenerationPlan from "./components/test-generation-plan.js";
import Welcome from "./components/welcome.js";
import ChatPanel from "./components/chat-panel.js";

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
  tests?: ProposedTest[];
  id?: string;
  executionStatus?: TestExecutionStatus;
  testFilePath?: string;
  conversationId?: string;
  sourceFile?: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  vscode,
  pendingPromises,
  createMessagePromise,
}) => {
  logger.component.render("DashboardPage", { vscodeAvailable: !!vscode });
  const queryClient = useQueryClient();

  // Test generation plan state
  const [testPlan, setTestPlan] = useState<ProposedTest[]>([]);
  const [testStatuses, setTestStatuses] = useState<
    Map<string, TestExecutionStatus>
  >(new Map());
  const [testErrors, setTestErrors] = useState<Map<string, string>>(new Map());
  const [testFilePaths, setTestFilePaths] = useState<Map<string, string>>(
    new Map(),
  );
  // Conversation state
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [activeSourceFile, setActiveSourceFile] = useState<
    string | undefined
  >();

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

      // Update the query cache with the new status
      if (message.command === WebviewMessages.cypressStatus && message.status) {
        queryClient.setQueryData<CypressStatusData>(
          ["cypress-status"],
          message.status,
        );
      }

      // Update the query cache with branch changes
      if (
        message.command === WebviewMessages.branchChangesStatus &&
        message.changes !== undefined
      ) {
        queryClient.setQueryData<BranchChangesData | null>(
          ["branch-changes"],
          message.changes,
        );
      }

      // Handle test generation plan
      if (message.command === WebviewMessages.testGenerationPlan) {
        if (message.error) {
          logger.error("Test generation plan error:", message.error);
        } else if (message.tests) {
          setTestPlan(message.tests);
          // Initialize all tests as pending
          const initialStatuses = new Map<string, TestExecutionStatus>();
          message.tests.forEach((test) => {
            initialStatuses.set(test.id, "pending");
          });
          setTestStatuses(initialStatuses);
          setTestErrors(new Map());
          setTestFilePaths(new Map());
        }
        // Set conversation ID and source file if provided
        if (message.conversationId) {
          setConversationId(message.conversationId);
        }
        if (message.sourceFile) {
          setActiveSourceFile(message.sourceFile);
        }
      }

      // Handle conversation started
      if (message.command === WebviewMessages.startConversation) {
        if (message.conversationId) {
          setConversationId(message.conversationId);
        }
        if (message.sourceFile) {
          setActiveSourceFile(message.sourceFile);
        }
      }

      // Handle test execution updates
      if (
        message.command === WebviewMessages.testExecutionUpdate &&
        message.id
      ) {
        const testId = message.id;
        if (!testId) {
          return;
        }

        setTestStatuses((prev) => {
          const next = new Map(prev);
          if (message.executionStatus) {
            next.set(testId, message.executionStatus);
          }
          return next;
        });

        const testFilePath = message.testFilePath;
        if (testFilePath) {
          setTestFilePaths((prev) => {
            const next = new Map(prev);
            next.set(testId, testFilePath);
            return next;
          });
        }

        const error = message.error;
        if (error) {
          setTestErrors((prev) => {
            const next = new Map(prev);
            next.set(testId, error);
            return next;
          });
        }
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

  // Query for Cypress status
  const { data: cypressStatus, isLoading } = useQuery<CypressStatusData, Error>(
    {
      queryKey: ["cypress-status"],
      queryFn: async () => {
        logger.query.start("cypress-status");
        try {
          const message = (await createMessagePromise(
            vscode,
            WebviewMessages.refreshStatus,
            WebviewMessages.cypressStatus,
          )) as MessageData;

          if (!message.status) {
            throw new Error("No status received");
          }

          logger.query.success("cypress-status", message.status);
          return message.status;
        } catch (error) {
          logger.query.error("cypress-status", error);
          throw error;
        }
      },
      refetchInterval: false,
    },
  );

  // Query for branch changes
  const {
    data: branchChanges,
    isLoading: branchChangesLoading,
    error: branchChangesError,
  } = useQuery<BranchChangesData | null, Error>({
    queryKey: ["branch-changes"],
    queryFn: async () => {
      logger.query.start("branch-changes");
      try {
        const message = (await createMessagePromise(
          vscode,
          WebviewMessages.getBranchChanges,
          WebviewMessages.branchChangesStatus,
        )) as MessageData;

        logger.query.success("branch-changes", message.changes);
        return message.changes ?? null;
      } catch (error) {
        logger.query.error("branch-changes", error);
        throw error;
      }
    },
    refetchInterval: false,
  });

  // Handler for creating test for a single file
  const handleCreateTestForFile = useCallback(
    (filePath: string) => {
      vscode.postMessage({
        command: WebviewMessages.createTestForFile,
        filePath,
      });
    },
    [vscode],
  );

  // Handler for creating tests for all changed files
  const handleCreateAllTests = useCallback(() => {
    if (branchChanges?.files && branchChanges.files.length > 0) {
      const filePaths = branchChanges.files.map((file) => file.path);
      vscode.postMessage({
        command: WebviewMessages.planTestGeneration,
        files: filePaths,
      });
    }
  }, [branchChanges, vscode]);

  // Handler for accepting a test
  const handleAcceptTest = useCallback((id: string) => {
    setTestStatuses((prev) => {
      const next = new Map(prev);
      next.set(id, "accepted");
      return next;
    });
  }, []);

  // Handler for previewing test diff
  const handlePreviewTestDiff = useCallback(
    (test: ProposedTest) => {
      vscode.postMessage({
        command: WebviewMessages.previewTestDiff,
        test: {
          id: test.id,
          targetTestPath: test.targetTestPath,
          proposedContent: test.proposedContent,
          existingContent: test.existingContent,
          isUpdate: test.isUpdate,
        },
      });
    },
    [vscode],
  );

  // Handler for rejecting a test
  const handleRejectTest = useCallback((id: string) => {
    setTestStatuses((prev) => {
      const next = new Map(prev);
      next.set(id, "rejected");
      return next;
    });
  }, []);

  // Handler for generating accepted tests
  const handleGenerateTests = useCallback(
    (acceptedIds: string[]) => {
      if (acceptedIds.length === 0) {
        return;
      }

      vscode.postMessage({
        command: WebviewMessages.confirmTestPlan,
        acceptedIds,
        tests: testPlan,
      });
    },
    [vscode, testPlan],
  );

  if (isLoading && !cypressStatus) {
    return <Welcome />;
  }

  if (!cypressStatus) {
    return <Welcome />;
  }

  return (
    <div className="w-full space-y-4 p-4">
      {testPlan.length > 0 ? (
        <div className="space-y-4">
          <TestGenerationPlan
            tests={testPlan}
            testStatuses={testStatuses}
            testErrors={testErrors}
            testFilePaths={testFilePaths}
            onAccept={handleAcceptTest}
            onReject={handleRejectTest}
            onGenerate={handleGenerateTests}
            onPreviewDiff={handlePreviewTestDiff}
          />
          {activeSourceFile && (
            <ChatPanel
              vscode={vscode}
              sourceFile={activeSourceFile}
              conversationId={conversationId}
            />
          )}
        </div>
      ) : (
        <BranchChanges
          changes={branchChanges ?? null}
          isLoading={branchChangesLoading}
          error={branchChangesError?.message}
          onCreateTest={handleCreateTestForFile}
          onCreateAllTests={handleCreateAllTests}
        />
      )}
    </div>
  );
};
