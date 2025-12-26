import type React from "react";
import { FileCode, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@clive/ui/drawer";
import { Badge } from "@clive/ui/badge";
import { cn } from "@clive/ui/lib/utils";
import type {
  TestFileExecution,
  TestResult,
} from "../utils/parse-test-output.js";

export interface TestStatusDrawerProps {
  testExecution: TestFileExecution | null;
  onClose?: () => void;
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
 * Get status badge variant
 */
const getStatusBadgeVariant = (
  status: TestFileExecution["status"],
): "default" | "destructive" | "secondary" => {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "running":
      return "secondary";
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

export const TestStatusDrawer: React.FC<TestStatusDrawerProps> = ({
  testExecution,
  onClose,
}) => {
  if (!testExecution) {
    return null;
  }

  const fileName = getFileName(testExecution.filePath);
  const isOpen = testExecution !== null;

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open: boolean) => !open && onClose?.()}
    >
      <DrawerContent
        className="max-h-[80vh]"
        data-vaul-drawer-direction="bottom"
      >
        <DrawerHeader className="border-b">
          <div className="flex items-center gap-3">
            <FileCode className="size-5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <DrawerTitle className="truncate">{fileName}</DrawerTitle>
              {testExecution.summary && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">
                    {testExecution.summary.total} test
                    {testExecution.summary.total !== 1 ? "s" : ""}
                  </span>
                  {testExecution.summary.passed > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-green-600 dark:text-green-500">
                        {testExecution.summary.passed} passed
                      </span>
                    </>
                  )}
                  {testExecution.summary.failed > 0 && (
                    <>
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-red-600 dark:text-red-500">
                        {testExecution.summary.failed} failed
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
            <Badge variant={getStatusBadgeVariant(testExecution.status)}>
              {testExecution.status === "running"
                ? "Running"
                : testExecution.status === "completed"
                  ? "Completed"
                  : "Failed"}
            </Badge>
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto p-4">
          {testExecution.tests.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              <span>Waiting for test results...</span>
            </div>
          ) : (
            <div className="space-y-2">
              {testExecution.tests.map((test, index) => (
                <div
                  key={`${test.testName}-${index}`}
                  className={cn(
                    "flex items-start gap-3 rounded-md border p-3 transition-colors",
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
      </DrawerContent>
    </Drawer>
  );
};
