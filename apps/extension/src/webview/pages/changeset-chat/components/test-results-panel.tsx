import type React from "react";
import { FileCode, CheckCircle2, XCircle, Loader2, ChevronDownIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@clive/ui/collapsible";
import { Badge } from "@clive/ui/badge";
import { cn } from "@clive/ui/lib/utils";
import type {
  TestFileExecution,
  TestResult,
} from "../utils/parse-test-output.js";

export interface TestResultsPanelProps {
  testExecutions: TestFileExecution[];
}

/**
 * Extract filename from file path
 */
const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

/**
 * Get status icon for a test result
 */
const getTestStatusIcon = (status: TestResult["status"]) => {
  switch (status) {
    case "pass":
      return (
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
      );
    case "fail":
      return <XCircle className="size-4 text-red-600 dark:text-red-500" />;
    case "running":
      return <Loader2 className="size-4 text-muted-foreground animate-spin" />;
  }
};

/**
 * Get suite status icon
 */
const getSuiteStatusIcon = (status: TestFileExecution["status"]) => {
  switch (status) {
    case "completed":
      return (
        <CheckCircle2 className="size-4 text-green-600 dark:text-green-500" />
      );
    case "failed":
      return <XCircle className="size-4 text-red-600 dark:text-red-500" />;
    case "running":
      return <Loader2 className="size-4 text-muted-foreground animate-spin" />;
  }
};

/**
 * Format duration in milliseconds to readable string
 */
const formatDuration = (ms?: number): string => {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const TestResultsPanel: React.FC<TestResultsPanelProps> = ({
  testExecutions,
}) => {
  if (testExecutions.length === 0) {
    return null;
  }

  return (
    <div className="border-t bg-background">
      <div className="max-h-[40vh] overflow-y-auto">
        <div className="px-4 py-2 border-b">
          <h3 className="text-sm font-medium text-muted-foreground">
            Test Results
          </h3>
        </div>
        <div className="divide-y">
          {testExecutions.map((execution, index) => {
            const fileName = getFileName(execution.filePath);
            const summary = execution.summary;
            const passedCount = summary?.passed ?? 0;
            const totalCount = summary?.total ?? execution.tests.length;

            return (
              <Collapsible key={`${execution.filePath}-${index}`} defaultOpen={execution.status === "running"}>
                <CollapsibleTrigger className="w-full px-4 py-3 hover:bg-muted/50 transition-colors group">
                  <div className="flex items-center gap-3 w-full">
                    <div className="shrink-0">
                      {getSuiteStatusIcon(execution.status)}
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <FileCode className="size-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">
                          {fileName}
                        </span>
                      </div>
                      {summary && (
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {totalCount} test{totalCount !== 1 ? "s" : ""}
                          </span>
                          {passedCount > 0 && (
                            <>
                              <span className="text-xs text-muted-foreground">•</span>
                              <span className="text-xs text-green-600 dark:text-green-500">
                                {passedCount} passed
                              </span>
                            </>
                          )}
                          {summary.failed > 0 && (
                            <>
                              <span className="text-xs text-muted-foreground">•</span>
                              <span className="text-xs text-red-600 dark:text-red-500">
                                {summary.failed} failed
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    <Badge
                      variant={
                        execution.status === "completed"
                          ? "default"
                          : execution.status === "failed"
                            ? "destructive"
                            : "secondary"
                      }
                      className="shrink-0"
                    >
                      {execution.status === "running"
                        ? "Running"
                        : execution.status === "completed"
                          ? "Completed"
                          : "Failed"}
                    </Badge>
                    <ChevronDownIcon className="size-4 text-muted-foreground shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-3 pt-2">
                    {execution.tests.length === 0 ? (
                      <div className="flex items-center justify-center py-4 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin mr-2" />
                        <span className="text-xs">Waiting for test results...</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {execution.tests.map((test, testIndex) => (
                          <div
                            key={`${test.testName}-${testIndex}`}
                            className={cn(
                              "flex items-start gap-3 rounded-md border p-2.5 transition-colors",
                              test.status === "fail"
                                ? "border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20"
                                : test.status === "pass"
                                  ? "border-green-200 dark:border-green-900/50 bg-green-50/50 dark:bg-green-950/20"
                                  : "border-border bg-muted/30",
                            )}
                          >
                            <div className="mt-0.5 shrink-0">
                              {getTestStatusIcon(test.status)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm">{test.testName}</div>
                              {test.duration && (
                                <div className="text-xs text-muted-foreground mt-1">
                                  {formatDuration(test.duration)}
                                </div>
                              )}
                              {test.error && test.status === "fail" && (
                                <div className="mt-2 text-xs text-red-600 dark:text-red-400 font-mono bg-red-100 dark:bg-red-950/50 p-2 rounded border border-red-200 dark:border-red-900/50">
                                  {test.error}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </div>
    </div>
  );
};

