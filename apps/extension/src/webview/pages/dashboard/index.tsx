import type React from "react";
import { useCallback, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { VSCodeAPI } from "../../services/vscode.js";
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

      if (message.command === "test-generation-progress") {
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

      // Legacy message handlers - these are now handled by RPC hooks
      // Keeping for backward compatibility during migration
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

  // Generate test subscription
  const generateTestSubscription = rpc.agents.generateTest.useSubscription({
    enabled: false,
    onData: (data: unknown) => {
      const progress = data as {
        status?: string;
        message?: string;
        filePath?: string;
      };
      if (progress.status === "starting" || progress.status === "generating") {
        const filePath = progress.filePath;
        if (filePath) {
          setFileGenerationStates((prev) => {
            const next = new Map(prev);
            const currentState = next.get(filePath) || {
              status: "idle" as const,
              statusMessage: "",
              logs: [],
            };
            next.set(filePath, {
              status: "generating",
              statusMessage: progress.message || currentState.statusMessage,
              logs: progress.message
                ? [...currentState.logs, progress.message]
                : currentState.logs,
            });
            return next;
          });
        }
      }
    },
    onComplete: (result: unknown) => {
      const testResult = result as {
        success: boolean;
        testFilePath?: string;
        error?: string;
        filePath?: string;
      };
      const filePath = testResult.filePath;
      if (filePath) {
        setFileGenerationStates((prev) => {
          const next = new Map(prev);
          if (testResult.success) {
            next.set(filePath, {
              status: "completed" as const,
              statusMessage: testResult.testFilePath
                ? `Test created: ${testResult.testFilePath}`
                : "Test generation completed",
              logs: prev.get(filePath)?.logs || [],
              testFilePath: testResult.testFilePath,
            });
          } else {
            next.set(filePath, {
              status: "error" as const,
              statusMessage: testResult.error || "Test generation failed",
              logs: prev.get(filePath)?.logs || [],
              error: testResult.error,
            });
          }
          return next;
        });
      }
    },
    onError: (error) => {
      logger.error("Test generation error", error);
    },
  });

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

      generateTestSubscription.subscribe({ sourceFilePath: filePath });
    },
    [generateTestSubscription],
  );

  // Plan tests mutation
  const planTestsMutation = rpc.agents.planTests.useMutation({
    onSuccess: (data) => {
      setIsPlanningTests(false);
      setPlanningStatus("");
      if (data.error) {
        logger.error("Test generation plan error:", data.error);
      } else if (data.tests) {
        setTestPlan(data.tests);
        // Initialize all tests as pending
        const initialStatuses = new Map<string, TestExecutionStatus>();
        data.tests.forEach((test) => {
          initialStatuses.set(test.id, "pending");
        });
        setTestStatuses(initialStatuses);
        setTestErrors(new Map());
        setTestFilePaths(new Map());
      }
    },
    onError: (error) => {
      setIsPlanningTests(false);
      setPlanningStatus("");
      logger.error("Failed to plan tests", error);
    },
  });

  // Handler for creating tests for all changed files
  const handleCreateAllTests = useCallback(() => {
    if (branchChanges?.files && branchChanges.files.length > 0) {
      setIsPlanningTests(true);
      setPlanningStatus("Planning test generation for all files...");
      const filePaths = branchChanges.files.map((file) => file.path);
      planTestsMutation.mutate({ files: filePaths });
    }
  }, [branchChanges, planTestsMutation]);

  // Handler for accepting a test
  const handleAcceptTest = useCallback((id: string) => {
    setTestStatuses((prev) => {
      const next = new Map(prev);
      next.set(id, "accepted");
      return next;
    });
  }, []);

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

  // Start conversation mutation
  const startConversationMutation = rpc.conversations.start.useMutation({
    onSuccess: (data) => {
      if (data.conversationId) {
        setConversationId(data.conversationId);
      }
      if (data.sourceFile) {
        setActiveSourceFile(data.sourceFile);
      }
    },
  });

  // Handler for navigating to chat view
  const handleNavigateToChat = useCallback(
    (sourceFile: string) => {
      setActiveSourceFile(sourceFile);
      // If no conversation exists, start one
      if (!conversationId) {
        startConversationMutation.mutate({ sourceFile });
      }
    },
    [conversationId, startConversationMutation],
  );

  // Handler for rejecting a test
  const handleRejectTest = useCallback((id: string) => {
    setTestStatuses((prev) => {
      const next = new Map(prev);
      next.set(id, "rejected");
      return next;
    });
  }, []);

  // Execute test mutation
  const executeTestMutation = rpc.agents.executeTest.useMutation({
    onSuccess: (data) => {
      if (data.executionStatus === "completed") {
        setTestStatuses((prev) => {
          const next = new Map(prev);
          next.set(data.id, "completed");
          return next;
        });
        if (data.testFilePath) {
          setTestFilePaths((prev) => {
            const next = new Map(prev);
            next.set(data.id, data.testFilePath || "");
            return next;
          });
        }
      } else {
        setTestStatuses((prev) => {
          const next = new Map(prev);
          next.set(data.id, data.executionStatus);
          return next;
        });
        if (data.error) {
          setTestErrors((prev) => {
            const next = new Map(prev);
            next.set(data.id, data.error);
            return next;
          });
        }
      }
    },
    onError: (error: Error) => {
      logger.error("Failed to execute test", error);
    },
  });

  // Handler for generating accepted tests
  const handleGenerateTests = useCallback(
    (acceptedIds: string[]) => {
      if (acceptedIds.length === 0) {
        return;
      }

      const testsToExecute = testPlan.filter((test) =>
        acceptedIds.includes(test.id),
      );

      testsToExecute.forEach((test) => {
        executeTestMutation.mutate({ test });
      });
    },
    [testPlan, executeTestMutation],
  );

  // Cancel test mutation
  const cancelTestMutation = rpc.agents.cancelTest.useMutation({
    onSuccess: (data) => {
      if (data.isFilePath) {
        setFileGenerationStates((prev) => {
          const next = new Map(prev);
          next.set(data.testId, {
            status: "error" as const,
            statusMessage: "Test generation cancelled",
            logs: prev.get(data.testId)?.logs || [],
            error: "Test generation cancelled",
          });
          return next;
        });
      } else {
        setTestStatuses((prev) => {
          const next = new Map(prev);
          next.set(data.testId, "pending");
          return next;
        });
      }
    },
  });

  // Handler for canceling a test
  const handleCancelTest = useCallback(
    (id: string) => {
      cancelTestMutation.mutate({ testId: id });
    },
    [cancelTestMutation],
  );

  // Handler for canceling a single file test
  const handleCancelFileTest = useCallback(
    (filePath: string) => {
      cancelTestMutation.mutate({ testId: filePath });
    },
    [cancelTestMutation],
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
          onViewTest={handleViewTest}
        />
      )}
    </div>
  );
};
