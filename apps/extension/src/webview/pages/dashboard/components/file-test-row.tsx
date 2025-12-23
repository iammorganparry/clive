import type React from "react";
import { useCallback } from "react";
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
  const { state, send } = useFileTestActor(file.path, vscode);

  const handleCreateTest = useCallback(() => {
    send({ type: "CREATE_TEST" });
  }, [send]);

  const handleCancel = useCallback(() => {
    send({ type: "CANCEL" });
  }, [send]);

  const isPlanning = state.matches({ planningPhase: "planning" });
  const isStreaming = state.matches({ planningPhase: "streaming" });
  const isAwaitingApproval = state.matches({
    planningPhase: "awaitingApproval",
  });
  const isGenerating = state.matches("generating");
  const isCompleted = state.matches("completed");
  const isError = state.matches("error");

  const hasProposals = state.context.proposals.length > 0;

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

        {/* Error */}
        {isError && state.context.error && (
          <TaskItem className="text-destructive text-xs flex items-center gap-2">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span>{state.context.error}</span>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  );
};

export default FileTestRow;
