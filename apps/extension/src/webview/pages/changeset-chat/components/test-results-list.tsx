import { QueueItemDescription } from "@clive/ui/components/ai-elements/queue";
import { Loader2 } from "lucide-react";
import type React from "react";
import type { TestFileExecution } from "../utils/parse-test-output.js";
import { TestResultSubItem } from "./test-result-sub-item.js";

interface TestResultsListProps {
  testResults?: TestFileExecution;
  expanded?: boolean;
}

/**
 * Renders all test results for a suite as sub-items
 */
export const TestResultsList: React.FC<TestResultsListProps> = ({
  testResults,
  expanded = true,
}) => {
  if (!testResults || testResults.tests.length === 0) {
    return (
      <div className="ml-6 py-2 text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Waiting for test results...
      </div>
    );
  }

  if (!expanded) {
    // Show summary when collapsed
    const summary = testResults.summary;
    const passedCount = summary?.passed ?? 0;
    const failedCount = summary?.failed ?? 0;
    const totalCount = summary?.total ?? testResults.tests.length;

    return (
      <QueueItemDescription className="ml-6">
        {totalCount} test{totalCount !== 1 ? "s" : ""}
        {passedCount > 0 && ` • ${passedCount} passed`}
        {failedCount > 0 && ` • ${failedCount} failed`}
      </QueueItemDescription>
    );
  }

  return (
    <ul className="ml-4 space-y-0.5">
      {testResults.tests.map((test, idx) => (
        <TestResultSubItem key={`${test.testName}-${idx}`} test={test} />
      ))}
    </ul>
  );
};
