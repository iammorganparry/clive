import type React from "react";
import { useState, useCallback } from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import {
  Task,
  TaskTrigger,
  TaskContent,
  TaskItem,
} from "@clive/ui/task";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Loader2,
  AlertCircle,
  XCircle,
} from "lucide-react";

export interface EligibleFile {
  path: string;
  relativePath: string;
  status: "M" | "A" | "D" | "R";
  isEligible: boolean;
}

export interface BranchChangesData {
  branchName: string;
  baseBranch: string;
  files: EligibleFile[];
  workspaceRoot: string;
}

export interface FileGenerationState {
  status: "idle" | "generating" | "completed" | "error";
  statusMessage: string;
  logs: string[];
  error?: string;
}

interface BranchChangesProps {
  changes: BranchChangesData | null;
  isLoading: boolean;
  error?: string;
  fileStates: Map<string, FileGenerationState>;
  onCreateTest: (filePath: string) => void;
  onCreateAllTests: () => void;
  isGenerating?: boolean;
  generationStatus?: string;
  onCancelTest: (filePath: string) => void;
}

const BranchChanges: React.FC<BranchChangesProps> = ({
  changes,
  isLoading,
  error,
  fileStates,
  onCreateTest,
  onCreateAllTests,
  isGenerating = false,
  generationStatus = "",
  onCancelTest,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription>Loading changed files...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription className="text-destructive">
            {error}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!changes || changes.files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription>
            No eligible files changed on this branch
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { branchName, files } = changes;

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={handleToggle}
          className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            BRANCH
          </CardTitle>
        </button>
        <CardDescription className="flex items-center gap-2 ml-6">
          <span>{branchName}</span>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Edit branch"
          >
            <FileText className="h-3 w-3" />
          </button>
        </CardDescription>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-2">
          <div className="space-y-2">
            {files.map((file) => {
              const fileState = fileStates.get(file.path);
              const isFileGenerating = fileState?.status === "generating";
              const hasLogs = fileState?.logs && fileState.logs.length > 0;

              return (
                <Task
                  key={file.path}
                  defaultOpen={isFileGenerating || fileState?.status === "error"}
                >
                  <div className="flex items-center gap-2">
                    <TaskTrigger
                      title={file.relativePath}
                      className="flex-1 min-w-0"
                    >
                      <div className="flex items-center gap-2 w-full cursor-pointer text-muted-foreground text-sm transition-colors hover:text-foreground">
                        <FileText className="h-4 w-4 flex-shrink-0" />
                        <span className="text-xs font-mono w-4 flex-shrink-0">
                          {file.status}
                        </span>
                        <span className="text-sm flex-1 truncate">
                          {file.relativePath}
                        </span>
                        <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180 flex-shrink-0" />
                      </div>
                    </TaskTrigger>
                    {isFileGenerating ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-6 px-2 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCancelTest(file.path);
                        }}
                      >
                        <XCircle className="h-3 w-3 mr-1" />
                        Cancel
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCreateTest(file.path);
                        }}
                      >
                        <Plus className="h-3 w-3 mr-1" />
                        Test
                      </Button>
                    )}
                  </div>
                  {(hasLogs || fileState?.error) && (
                    <TaskContent>
                      {fileState?.logs.map((log, i) => (
                        <TaskItem key={`${file.path}-log-${i}-${log.slice(0, 20)}`}>
                          {log}
                        </TaskItem>
                      ))}
                      {fileState?.error && (
                        <TaskItem className="text-destructive">
                          <AlertCircle className="h-3 w-3 inline mr-1" />
                          {fileState.error}
                        </TaskItem>
                      )}
                    </TaskContent>
                  )}
                </Task>
              );
            })}
          </div>

          <div className="pt-2 border-t space-y-2">
            {isGenerating && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Generating test plan...</p>
                  {generationStatus && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {generationStatus}
                    </p>
                  )}
                </div>
              </div>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={onCreateAllTests}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Tests for All Changes
                </>
              )}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default BranchChanges;
