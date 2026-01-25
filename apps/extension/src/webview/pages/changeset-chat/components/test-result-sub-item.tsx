import {
  QueueItem,
  QueueItemContent,
  QueueItemDescription,
  QueueItemIndicator,
} from "@clive/ui/components/ai-elements/queue";
import { cn } from "@clive/ui/lib/utils";
import { XCircle } from "lucide-react";
import type React from "react";
import type { TestResult } from "../utils/parse-test-output.js";

interface TestResultSubItemProps {
  test: TestResult;
}

/**
 * Format duration in milliseconds to readable string
 */
const formatDuration = (ms?: number): string => {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

/**
 * Renders a single test result as a queue sub-item
 */
export const TestResultSubItem: React.FC<TestResultSubItemProps> = ({
  test,
}) => {
  const isPassed = test.status === "pass";
  const isFailed = test.status === "fail";
  const isRunning = test.status === "running";

  return (
    <QueueItem className="ml-4 py-0.5">
      <div className="flex items-start gap-2 w-full">
        {isRunning ? (
          <div className="mt-0.5 shrink-0">
            <div className="size-2.5 rounded-full border border-muted-foreground/50 animate-pulse" />
          </div>
        ) : isFailed ? (
          <div className="mt-0.5 shrink-0">
            <XCircle className="size-3 text-red-600 dark:text-red-500" />
          </div>
        ) : (
          <QueueItemIndicator completed={isPassed} />
        )}
        <div className="flex-1 min-w-0">
          <QueueItemContent completed={isPassed}>
            {test.testName}
          </QueueItemContent>
          {test.duration && (
            <QueueItemDescription completed={isPassed}>
              {formatDuration(test.duration)}
            </QueueItemDescription>
          )}
          {test.error && isFailed && (
            <QueueItemDescription
              completed={false}
              className={cn(
                "mt-1 text-xs text-red-600 dark:text-red-400 font-mono",
                "bg-red-50 dark:bg-red-950/30 p-2 rounded border border-red-200 dark:border-red-900/50",
                "line-through-0",
              )}
            >
              {test.error}
            </QueueItemDescription>
          )}
        </div>
      </div>
    </QueueItem>
  );
};
