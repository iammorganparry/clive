import { Button } from "@clive/ui/button";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@clive/ui/components/ai-elements/code-block";
import { cn } from "@clive/ui/lib/utils";
import { ScrollArea } from "@clive/ui/scroll-area";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from "@clive/ui/task";
import { addCollection, Icon } from "@iconify/react";
import vscodeIconsData from "@iconify-json/vscode-icons/icons.json";
import { ChevronDownIcon, Loader2, X } from "lucide-react";
import type React from "react";
import { useCallback } from "react";
import { DiffPreview } from "./diff-preview.js";
import { formatToolOutput } from "./tool-call/format-output.js";
import {
  useOpenFile,
  useToolAbort,
  useToolApproval,
} from "./tool-call/hooks.js";
import { getStatusBadge, getToolIcon } from "./tool-call/icons.js";
// Import from refactored modules
import {
  extractFileInfo,
  extractFilename,
  extractFilePaths,
  type FileMatch,
  generateActionList,
  getFileIcon,
  getToolDisplayInfo,
  isBashExecuteArgs,
  isEditFileContentArgs,
  isFileWritingTool,
  parseFindOutput,
  parseGrepOutput,
  type ToolCallCardProps,
  truncatePath,
} from "./tool-call/index.js";

// Add vscode-icons collection for offline use
addCollection(vscodeIconsData);

// Re-export props type for external use
export type { ToolCallCardProps };

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  state,
  input,
  output,
  errorText,
  streamingContent,
  toolCallId,
  subscriptionId,
}) => {
  const displayInfo = getToolDisplayInfo(toolName, input, output);
  const hasError = state === "output-error" || !!errorText;
  const filePaths = extractFilePaths(toolName, input, output);

  const { handleApprove, handleReject, canApprove } = useToolApproval(
    toolCallId,
    subscriptionId,
  );
  const { handleCancel, canAbort, isAborting } = useToolAbort(
    toolCallId,
    subscriptionId,
  );
  const { handleOpenFile } = useOpenFile();

  // Check if this is a file-writing tool with code content
  const fileInfo = extractFileInfo(toolName, input, output, streamingContent);
  const isStreaming = !!streamingContent && state !== "output-available";
  const isCodeWritingTool =
    isFileWritingTool(toolName) &&
    fileInfo &&
    (state === "output-available" || isStreaming) &&
    !errorText;

  // Check if this tool has grouped results (grep/find with file matches)
  const command = isBashExecuteArgs(input)
    ? input.command
    : output && typeof output === "object"
      ? (output as { command?: string }).command
      : "";
  const hasGroupedResults = Boolean(
    (toolName === "bashExecute" || toolName === "Bash") &&
      command &&
      (command.includes("grep") || command.includes("find")) &&
      output &&
      typeof output === "object" &&
      (output as { stdout?: string }).stdout,
  );

  // Render grep/find file lists
  const renderGrepFindResults = useCallback((): React.ReactNode => {
    if (
      (toolName === "bashExecute" || toolName === "Bash") &&
      typeof output === "object"
    ) {
      const bashOutput = output as { stdout?: string; command?: string };
      const cmd = isBashExecuteArgs(input)
        ? input.command
        : bashOutput.command || "";

      // Grep results
      if (cmd.includes("grep") && bashOutput.stdout) {
        const fileMatches = parseGrepOutput(bashOutput.stdout);
        if (fileMatches.length > 0) {
          return (
            <>
              {fileMatches.map((match: FileMatch) => {
                const filename = extractFilename(match.filePath);
                const truncatedPath = truncatePath(match.filePath);
                return (
                  <TaskItem key={match.filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(match.filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon
                          icon={getFileIcon(match.filePath)}
                          className="text-base shrink-0"
                        />
                        <span className="truncate">{filename}</span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {truncatedPath}
                        </span>
                        <span className="ml-auto text-xs font-medium">
                          {match.count}
                        </span>
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                );
              })}
            </>
          );
        }
      }

      // Find results
      if (cmd.includes("find") && bashOutput.stdout) {
        const files = parseFindOutput(bashOutput.stdout);
        if (files.length > 0) {
          return (
            <>
              {files.slice(0, 50).map((filePath: string) => {
                const filename = extractFilename(filePath);
                const truncatedPath = truncatePath(filePath);
                return (
                  <TaskItem key={filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon
                          icon={getFileIcon(filePath)}
                          className="text-base shrink-0"
                        />
                        <span className="truncate">{filename}</span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {truncatedPath}
                        </span>
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                );
              })}
              {files.length > 50 && (
                <TaskItem>
                  <span className="text-xs text-muted-foreground">
                    ... and {files.length - 50} more files
                  </span>
                </TaskItem>
              )}
            </>
          );
        }
      }
    }
    return null;
  }, [toolName, input, output, handleOpenFile]);

  // Render action list
  const renderActionList = useCallback((): React.ReactNode => {
    const actions = generateActionList(toolName, input, output);
    if (actions.length > 0) {
      return (
        <>
          {actions.map((action) => (
            <TaskItem key={action}>{action}</TaskItem>
          ))}
        </>
      );
    }
    return null;
  }, [toolName, input, output]);

  // Render formatted output
  const renderFormattedOutput = useCallback((): React.ReactNode => {
    const formattedOutput = formatToolOutput(toolName, output, errorText);
    if (formattedOutput) {
      return <div className="mt-2">{formattedOutput}</div>;
    }
    return null;
  }, [toolName, output, errorText]);

  // Determine title for TaskTrigger (tooltip)
  const triggerTitle =
    isCodeWritingTool && fileInfo
      ? extractFilename(fileInfo.filePath)
      : displayInfo.context || displayInfo.label;

  const statusBadge = getStatusBadge(state);
  const toolIcon = getToolIcon(toolName);

  // For editFileContent, render DiffPreview with Claude Code-style diff view
  if (
    toolName === "editFileContent" &&
    isEditFileContentArgs(input) &&
    input.diff
  ) {
    const filePath = input.targetPath || input.filePath || "unknown";
    return (
      <DiffPreview
        filePath={filePath}
        diff={input.diff}
        onOpenFile={handleOpenFile}
      />
    );
  }

  return (
    <Task
      defaultOpen={hasGroupedResults}
      className={cn(hasError && "opacity-75", "w-full")}
    >
      <TaskTrigger title={triggerTitle}>
        <div className="group flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
          {toolIcon}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isCodeWritingTool && fileInfo ? (
              <>
                <Icon
                  icon={getFileIcon(fileInfo.filePath)}
                  className="text-base shrink-0"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenFile(fileInfo.filePath);
                  }}
                  className="font-medium text-sm hover:underline text-left"
                  title={`Open ${fileInfo.filePath}`}
                >
                  {extractFilename(fileInfo.filePath)}
                </button>
              </>
            ) : (
              <>
                <span className="text-sm shrink-0">{displayInfo.label}</span>
                {displayInfo.context && (
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-xs font-mono text-muted-foreground truncate max-w-[300px]"
                    title={displayInfo.context}
                  >
                    {displayInfo.context}
                  </span>
                )}
              </>
            )}
          </div>
          {statusBadge && (
            <div className="flex items-center gap-2 shrink-0">
              {statusBadge}
            </div>
          )}
          <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        </div>
      </TaskTrigger>
      <TaskContent>
        <ScrollArea className="max-h-[300px]">
          {/* Code Writing Tools - Show code prominently */}
          {isCodeWritingTool && fileInfo ? (
            <div className="mt-2">
              {isStreaming && (
                <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                  <span>Streaming file content...</span>
                </div>
              )}
              <CodeBlock
                code={fileInfo.content}
                language={fileInfo.language}
                showLineNumbers={true}
              >
                <CodeBlockCopyButton />
              </CodeBlock>
            </div>
          ) : (
            <>
              {/* Grep/Find File Lists */}
              {renderGrepFindResults()}

              {/* Action List */}
              {renderActionList()}

              {/* Output/Result */}
              {renderFormattedOutput()}

              {/* File Links Section */}
              {filePaths.length > 0 &&
                filePaths.map((filePath) => (
                  <TaskItem key={filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon
                          icon={getFileIcon(filePath)}
                          className="text-base shrink-0"
                        />
                        {extractFilename(filePath)}
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                ))}
            </>
          )}
        </ScrollArea>
        {/* Footer with approve/reject actions */}
        {state === "approval-requested" &&
          canApprove &&
          !["writeTestFile", "editFileContent"].includes(toolName) && (
            <div className="flex justify-end gap-2 border-t pt-2 mt-2">
              <Button onClick={handleReject} variant="outline" size="sm">
                Reject
              </Button>
              <Button onClick={handleApprove} variant="default" size="sm">
                Approve
              </Button>
            </div>
          )}
        {/* Cancel button for running bash commands */}
        {(state === "input-streaming" || state === "input-available") &&
          canAbort &&
          (toolName === "bashExecute" || toolName === "Bash") && (
            <div className="flex justify-end gap-2 border-t pt-2 mt-2">
              <Button
                onClick={handleCancel}
                variant="outline"
                size="sm"
                disabled={isAborting}
                className="gap-1.5"
              >
                {isAborting ? (
                  <>
                    <Loader2 className="size-3 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  <>
                    <X className="size-3" />
                    Cancel
                  </>
                )}
              </Button>
            </div>
          )}
      </TaskContent>
    </Task>
  );
};
