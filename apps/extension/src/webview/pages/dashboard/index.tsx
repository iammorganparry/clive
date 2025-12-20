import type React from "react";
import { useCallback, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VSCodeAPI } from "../../services/vscode.js";
import { WebviewMessages } from "../../../constants.js";
import { logger } from "../../services/logger.js";
import { useRpc } from "../../rpc/provider.js";
import type {
  BranchChangesData,
  FileGenerationState,
} from "./components/branch-changes.js";
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
  planningStatus?: "planning" | "analyzing" | "generating_content" | "starting";
  message?: string;
  filePath?: string;
  success?: boolean;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  vscode,
  pendingPromises,
  createMessagePromise: _createMessagePromise,
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
  // Planning state (for "Create All Tests" flow)
  const [isPlanningTests, setIsPlanningTests] = useState(false);
  const [planningStatus, setPlanningStatus] = useState<string>("");
  // Per-file generation state
  const [fileGenerationStates, setFileGenerationStates] = useState<
    Map<string, FileGenerationState>
  >(new Map());

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

      // Handle test generation progress (for individual file generation)
      if (message.command === WebviewMessages.testGenerationProgress) {
        const filePath = message.filePath;
        if (filePath) {
          setFileGenerationStates((prev) => {
            const next = new Map(prev);
            const currentState = next.get(filePath) || {
              status: "idle" as const,
              statusMessage: "",
              logs: [],
            };

            // Update status based on message status or default to generating
            const newStatus =
              message.planningStatus === "starting"
                ? ("generating" as const)
                : currentState.status === "idle"
                  ? ("generating" as const)
                  : currentState.status;

            // Add log message if provided
            const newLogs = message.message
              ? [...currentState.logs, message.message]
              : currentState.logs;

            next.set(filePath, {
              status: newStatus,
              statusMessage: message.message || currentState.statusMessage,
              logs: newLogs,
            });
            return next;
          });
        }
      }

      // Handle test generation plan
      if (message.command === WebviewMessages.testGenerationPlan) {
        setIsPlanningTests(false);
        setPlanningStatus("");
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

      // Handle test generation status (for individual file generation)
      if (message.command === WebviewMessages.testGenerationStatus) {
        const filePath = message.filePath;
        if (filePath) {
          setFileGenerationStates((prev) => {
            const next = new Map(prev);
            const currentState = next.get(filePath) || {
              status: "idle" as const,
              statusMessage: "",
              logs: [],
            };

            if (message.success !== undefined) {
              if (message.success) {
                // Generation completed successfully
                next.set(filePath, {
                  status: "completed" as const,
                  statusMessage: message.testFilePath
                    ? `Test created: ${message.testFilePath}`
                    : "Test generation completed",
                  logs: currentState.logs,
                });
              } else {
                // Generation failed
                next.set(filePath, {
                  status: "error" as const,
                  statusMessage: message.error || "Test generation failed",
                  logs: currentState.logs,
                  error: message.error,
                });
              }
            }
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

  // Get RPC client
  const rpc = useRpc();

  // Query for Cypress status using new RPC API
  const { data: cypressStatus, isLoading } = rpc.status.cypress.useQuery();

  // Query for branch changes using new RPC API
  const {
    data: branchChanges,
    isLoading: branchChangesLoading,
    error: branchChangesError,
  } = rpc.status.branchChanges.useQuery();

  // Handler for creating test for a single file
  const handleCreateTestForFile = useCallback(
    (filePath: string) => {
      // Initialize state for this file
      setFileGenerationStates((prev) => {
        const next = new Map(prev);
        next.set(filePath, {
          status: "generating",
          statusMessage: "Starting test generation...",
          logs: ["Starting test generation..."],
        });
        return next;
      });

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
      setIsPlanningTests(true);
      setPlanningStatus("Planning test generation for all files...");
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

  // Handler for navigating to chat view
  const handleNavigateToChat = useCallback(
    (sourceFile: string) => {
      setActiveSourceFile(sourceFile);
      // If no conversation exists, start one
      if (!conversationId) {
        vscode.postMessage({
          command: WebviewMessages.startConversation,
          sourceFile,
        });
      }
    },
    [vscode, conversationId],
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

  // Handler for canceling a test
  const handleCancelTest = useCallback(
    (id: string) => {
      vscode.postMessage({
        command: WebviewMessages.cancelTest,
        id,
      });
    },
    [vscode],
  );

  // Handler for canceling a single file test
  const handleCancelFileTest = useCallback(
    (filePath: string) => {
      vscode.postMessage({
        command: WebviewMessages.cancelTest,
        id: filePath,
      });
    },
    [vscode],
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
            onCancel={handleCancelTest}
            onGenerate={handleGenerateTests}
            onPreviewDiff={handlePreviewTestDiff}
            onNavigateToChat={handleNavigateToChat}
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
          fileStates={fileGenerationStates}
          onCreateTest={handleCreateTestForFile}
          onCreateAllTests={handleCreateAllTests}
          isGenerating={isPlanningTests}
          generationStatus={planningStatus}
          onCancelTest={handleCancelFileTest}
        />
      )}
    </div>
  );
};
