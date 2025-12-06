import type React from "react";
import { useState, useCallback, useMemo } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import { Check, X, Play, Loader2 } from "lucide-react";
import TestCard from "./test-card.js";
import type {
  ProposedTest,
  TestExecutionStatus,
} from "../../services/ai-agent/types.js";

interface TestGenerationPlanProps {
  tests: ProposedTest[];
  testStatuses: Map<string, TestExecutionStatus>;
  testErrors: Map<string, string>;
  testFilePaths: Map<string, string>;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onGenerate: (acceptedIds: string[]) => void;
}

const TestGenerationPlan: React.FC<TestGenerationPlanProps> = ({
  tests,
  testStatuses,
  testErrors,
  testFilePaths,
  onAccept,
  onReject,
  onGenerate,
}) => {
  const [localStatuses, setLocalStatuses] = useState<
    Map<string, "pending" | "accepted" | "rejected">
  >(new Map());

  // Merge local statuses with execution statuses
  const getStatus = useCallback(
    (id: string): TestExecutionStatus => {
      const executionStatus = testStatuses.get(id);
      if (executionStatus) {
        return executionStatus;
      }
      return localStatuses.get(id) || "pending";
    },
    [testStatuses, localStatuses],
  );

  const handleAccept = useCallback(
    (id: string) => {
      setLocalStatuses((prev) => {
        const next = new Map(prev);
        next.set(id, "accepted");
        return next;
      });
      onAccept(id);
    },
    [onAccept],
  );

  const handleReject = useCallback(
    (id: string) => {
      setLocalStatuses((prev) => {
        const next = new Map(prev);
        next.set(id, "rejected");
        return next;
      });
      onReject(id);
    },
    [onReject],
  );

  const handleAcceptAll = useCallback(() => {
    tests.forEach((test) => {
      if (getStatus(test.id) === "pending") {
        handleAccept(test.id);
      }
    });
  }, [tests, getStatus, handleAccept]);

  const handleRejectAll = useCallback(() => {
    tests.forEach((test) => {
      if (getStatus(test.id) === "pending") {
        handleReject(test.id);
      }
    });
  }, [tests, getStatus, handleReject]);

  const handleGenerate = useCallback(() => {
    const acceptedIds = tests
      .filter((test) => getStatus(test.id) === "accepted")
      .map((test) => test.id);
    onGenerate(acceptedIds);
  }, [tests, getStatus, onGenerate]);

  const acceptedCount = useMemo(
    () => tests.filter((test) => getStatus(test.id) === "accepted").length,
    [tests, getStatus],
  );

  const hasAcceptedTests = acceptedCount > 0;
  const hasPendingTests = tests.some(
    (test) => getStatus(test.id) === "pending",
  );
  const isGenerating = tests.some(
    (test) => getStatus(test.id) === "in_progress",
  );

  if (tests.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Test Generation Plan</CardTitle>
          <CardDescription>No tests proposed</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Test Generation Plan</CardTitle>
        <CardDescription>
          Review and accept the proposed Cypress tests. Accepted tests will be
          generated when you click "Generate Accepted Tests".
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAcceptAll}
            disabled={!hasPendingTests || isGenerating}
            className="h-8"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Accept All
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRejectAll}
            disabled={!hasPendingTests || isGenerating}
            className="h-8"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Reject All
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            onClick={handleGenerate}
            disabled={!hasAcceptedTests || isGenerating}
            className="h-8"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 mr-1.5" />
                Generate Accepted Tests ({acceptedCount})
              </>
            )}
          </Button>
        </div>

        {/* Test cards */}
        <div className="space-y-2">
          {tests.map((test) => (
            <TestCard
              key={test.id}
              test={test}
              status={getStatus(test.id)}
              error={testErrors.get(test.id)}
              testFilePath={testFilePaths.get(test.id)}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default TestGenerationPlan;
