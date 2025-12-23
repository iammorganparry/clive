import type React from "react";
import { useCallback } from "react";
import { useRpc } from "../../../rpc/provider.js";
import { useFileTestActor } from "../hooks/use-file-test-actor.js";
import type { EligibleFile } from "./branch-changes.js";
import { Button } from "../../../../components/ui/button.js";
import { Task, TaskTrigger, TaskContent, TaskItem } from "@clive/ui/task";
import {
  FileText,
  Plus,
  Loader2,
  AlertCircle,
  XCircle,
  CheckCircle,
  Eye,
  FileSearch,
  FileOutput,
  Settings,
  Play,
  Search,
  Circle,
} from "lucide-react";
import {
  truncateMiddle,
  truncateLogMessage,
} from "../../../utils/path-utils.js";
import InlineTestCard from "./inline-test-card.js";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";
import type { VSCodeAPI } from "../../../services/vscode.js";

// Helper to safely extract Map entries with proper typing
function getMapEntries<K, V>(map: Map<K, V>): Array<[K, V]> {
  return Array.from(map.entries());
}

// Log Icon Component - maps log messages to appropriate icons
interface LogIconProps {
  log: string;
  isCompleted?: boolean;
}

const LogIcon: React.FC<LogIconProps> = ({ log, isCompleted }) => {
  const lowerLog = log.toLowerCase();

  // Check if this is a "generating" message
  const isGeneratingMessage = lowerLog.includes("generating");

  // If generating and file is completed, show checkmark instead of spinner
  if (isGeneratingMessage && isCompleted) {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }

  if (lowerLog.includes("reading") || lowerLog.includes("read file")) {
    return <FileSearch className="h-3 w-3" />;
  }
  if (
    lowerLog.includes("writing") ||
    lowerLog.includes("written") ||
    lowerLog.includes("write test")
  ) {
    return <FileOutput className="h-3 w-3" />;
  }
  if (lowerLog.includes("config") || lowerLog.includes("configuration")) {
    return <Settings className="h-3 w-3" />;
  }
  if (lowerLog.includes("starting")) {
    return <Play className="h-3 w-3" />;
  }
  if (lowerLog.includes("completed") || lowerLog.includes("success")) {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }
  if (lowerLog.includes("analyzing")) {
    return <Search className="h-3 w-3" />;
  }
  if (isGeneratingMessage) {
    return <Loader2 className="h-3 w-3 animate-spin" />;
  }
  return <Circle className="h-3 w-3" />;
};

interface FileTestRowProps {
  file: EligibleFile;
  vscode: VSCodeAPI;
  onViewTest?: (testFilePath: string) => void;
  onPreviewDiff?: (test: ProposedTest) => void;
}

const FileTestRow: React.FC<FileTestRowProps> = ({
  file,
  vscode,
  onViewTest,
  onPreviewDiff,
}) => {
  const rpc = useRpc();
  const { state, send } = useFileTestActor(file.path, vscode);

  const handleCreateTest = useCallback(() => {
    send({ type: "CREATE_TEST" });
  }, [send]);

  const handleCancel = useCallback(() => {
    send({ type: "CANCEL" });
  }, [send]);

  const handleAccept = useCallback(
    (testId: string) => {
      send({ type: "APPROVE", testId });
    },
    [send],
  );

  const handleReject = useCallback(
    (testId: string) => {
      send({ type: "REJECT", testId });
    },
    [send],
  );

  // Execute test mutation
  const executeTestMutation = rpc.agents.executeTest.useMutation({
    onSuccess: (data) => {
      if (data.executionStatus === "completed" && data.testFilePath) {
        send({
          type: "EXECUTION_COMPLETE",
          testId: data.id,
          filePath: data.testFilePath,
        });
      } else {
        send({
          type: "EXECUTION_ERROR",
          testId: data.id,
          error: data.error || "Execution failed",
        });
      }
    },
    onError: (error: Error) => {
      // We'll handle this per-test in the loop
      send({
        type: "EXECUTION_ERROR",
        testId: "",
        error: error.message,
      });
    },
  });

  const handleGenerateTests = useCallback(() => {
    // Execute accepted tests
    const acceptedTests = state.context.proposals.filter(
      (test: ProposedTest) =>
        state.context.testStatuses.get(test.id) === "accepted",
    );

    for (const test of acceptedTests) {
      executeTestMutation.mutate({ test });
    }
  }, [
    state.context.proposals,
    state.context.testStatuses,
    executeTestMutation,
  ]);

  const isPlanning = state.matches({ planningPhase: "planning" });
  const isStreaming = state.matches({ planningPhase: "streaming" });
  const isAwaitingApproval = state.matches({
    planningPhase: "awaitingApproval",
  });
  const isGenerating = state.matches("generating");
  const isCompleted = state.matches("completed");
  const isError = state.matches("error");

  const hasProposals = state.context.proposals.length > 0;
  const acceptedCount = state.context.proposals.filter(
    (test: ProposedTest) =>
      state.context.testStatuses.get(test.id) === "accepted",
  ).length;
  const hasAcceptedTests = acceptedCount > 0;

  const handleViewPlan = useCallback(() => {
    if (state.context.planFilePath) {
      vscode.postMessage({
        type: "command",
        command: "vscode.open",
        args: [state.context.planFilePath],
      });
    }
  }, [state.context.planFilePath, vscode]);

  // Show accordion if planning, streaming, generating, completed, or has proposals
  const showAccordion =
    isPlanning ||
    isStreaming ||
    isAwaitingApproval ||
    isGenerating ||
    isCompleted ||
    hasProposals;

  if (!showAccordion) {
    return (
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-mono w-4 flex-shrink-0 text-muted-foreground">
          {file.status}
        </span>
        <span
          className="text-sm flex-1 truncate text-muted-foreground"
          title={file.path}
        >
          {truncateMiddle(file.relativePath)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 flex-shrink-0"
          onClick={handleCreateTest}
        >
          <Plus className="h-3 w-3 mr-1" />
          Test
        </Button>
      </div>
    );
  }

  return (
    <Task
      defaultOpen={
        isPlanning || isStreaming || isAwaitingApproval || isGenerating
      }
    >
      <TaskTrigger title={file.path} className="flex-1 min-w-0">
        <div className="flex items-center gap-2 w-full">
          {isPlanning || isStreaming || isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
          ) : isCompleted ? (
            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
          ) : isError ? (
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
          ) : null}
          <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          <span className="text-xs font-mono w-4 flex-shrink-0 text-muted-foreground">
            {file.status}
          </span>
          <span
            className="text-sm flex-1 truncate text-muted-foreground"
            title={file.path}
          >
            {truncateMiddle(file.relativePath)}
          </span>
          <div className="flex items-center gap-1">
            {state.context.planFilePath && !isCompleted && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 flex-shrink-0"
                onClick={handleViewPlan}
                title="View plan file"
              >
                <FileText className="h-3 w-3 mr-1" />
                Plan
              </Button>
            )}
            {isPlanning || isStreaming || isGenerating ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-6 px-2 flex-shrink-0"
                onClick={handleCancel}
              >
                <XCircle className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            ) : isCompleted && state.context.testFilePaths.size > 0 ? (
              <>
                {getMapEntries(state.context.testFilePaths).map(
                  ([testId, testPath]) => (
                    <Button
                      key={testId}
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 flex-shrink-0"
                      onClick={() => onViewTest?.(testPath)}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                  ),
                )}
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 flex-shrink-0"
                onClick={handleCreateTest}
              >
                <Plus className="h-3 w-3 mr-1" />
                Test
              </Button>
            )}
          </div>
        </div>
      </TaskTrigger>
      <TaskContent>
        {/* Logs - Only show progress checkpoints, not streaming conversation */}
        {state.context.logs.length > 0 && (
          <div className="space-y-1 mb-2">
            {state.context.logs.map((log: string, i: number) => (
              <TaskItem
                key={`${file.path}-log-${i}-${log.slice(0, 20)}`}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <span className="flex-shrink-0">
                  <LogIcon log={log} isCompleted={isCompleted} />
                </span>
                <span className="flex-1 truncate" title={log}>
                  {truncateLogMessage(log)}
                </span>
              </TaskItem>
            ))}
          </div>
        )}

        {/* Plan File Link */}
        {state.context.planFilePath && (
          <TaskItem className="text-xs mb-2">
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2"
              onClick={handleViewPlan}
            >
              <FileText className="h-3 w-3 mr-1" />
              View Plan: {state.context.planFilePath}
            </Button>
          </TaskItem>
        )}

        {/* Error */}
        {isError && state.context.error && (
          <TaskItem className="text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span>{state.context.error}</span>
          </TaskItem>
        )}

        {/* Test Proposals */}
        {hasProposals && (
          <div className="space-y-2 mt-2">
            <div className="text-xs font-medium text-muted-foreground">
              Test Plan ({state.context.proposals.length} proposals)
            </div>
            {state.context.proposals.map((test: ProposedTest) => {
              const status = state.context.testStatuses.get(test.id);
              const error = state.context.testErrors.get(test.id);
              const testFilePath = state.context.testFilePaths.get(test.id);
              return (
                <InlineTestCard
                  key={test.id}
                  test={test}
                  status={status ?? "pending"}
                  error={error ?? undefined}
                  testFilePath={testFilePath ?? undefined}
                  onAccept={handleAccept}
                  onReject={handleReject}
                  onPreviewDiff={onPreviewDiff}
                />
              );
            })}
            {isAwaitingApproval && hasAcceptedTests && (
              <Button
                size="sm"
                variant="default"
                className="w-full mt-2"
                onClick={handleGenerateTests}
              >
                Build Accepted Tests ({acceptedCount})
              </Button>
            )}
          </div>
        )}
      </TaskContent>
    </Task>
  );
};

export default FileTestRow;
