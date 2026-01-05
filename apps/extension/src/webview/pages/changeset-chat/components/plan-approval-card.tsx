import type React from "react";
import { useState, useCallback } from "react";
import { Circle } from "lucide-react";
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Button } from "@clive/ui/button";
import { Input } from "@clive/ui/input";
import { Separator } from "@clive/ui/separator";import { cn } from "@clive/ui";
;

export type ApprovalMode = "auto" | "manual";

export interface PlanApprovalCardProps {
  /** Whether the plan is still streaming */
  isStreaming?: boolean;
  /** Called when user approves the plan */
  onApprove: (mode: ApprovalMode) => void;
  /** Called when user wants to keep planning with feedback */
  onReject: (feedback: string) => void;
  /** Additional class names */
  className?: string;
}

/**
 * Plan Approval Card Component
 *
 * Displays the agent's plan with approval options similar to Claude Code's UI.
 * Shows the plan content with formatted markdown and provides three approval options:
 * - Auto-accept: Approve and auto-approve all file writes
 * - Manual approve: Approve but require manual approval for each file
 * - Keep planning: Reject and provide feedback
 */
export const PlanApprovalCard: React.FC<PlanApprovalCardProps> = ({
  isStreaming = false,
  onApprove,
  onReject,
  className,
}) => {
  const [feedback, setFeedback] = useState("");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  const handleAutoAccept = useCallback(() => {
    setSelectedOption(1);
    onApprove("auto");
  }, [onApprove]);

  const handleManualApprove = useCallback(() => {
    setSelectedOption(2);
    onApprove("manual");
  }, [onApprove]);

  const handleKeepPlanning = useCallback(() => {
    setSelectedOption(3);
    // If there's feedback, send it; otherwise just dismiss
    onReject(feedback.trim() || "Please revise the plan.");
  }, [onReject, feedback]);

  const handleFeedbackSubmit = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && feedback.trim()) {
        e.preventDefault();
        onReject(feedback.trim());
      }
    },
    [onReject, feedback],
  );

  return (
    <Card className={cn("w-full shadow-sm", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Circle className="size-2.5 fill-primary text-primary" />
          <CardTitle className="text-sm font-medium">Clive's Plan</CardTitle>
        </div>
      </CardHeader>

      {!isStreaming && (
        <>
          <Separator className="mx-3" />

          <CardFooter className="flex-col items-start gap-3 pt-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Accept this plan?</p>
              <p className="text-xs text-muted-foreground">
                Review the plan above and decide whether to proceed
              </p>
            </div>

            <div className="flex w-full flex-col gap-2">
              <Button
                variant={selectedOption === 1 ? "default" : "outline"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={handleAutoAccept}
                disabled={selectedOption !== null}
              >
                <span className="flex size-5 items-center justify-center rounded border bg-muted text-xs font-medium">
                  1
                </span>
                Yes, and auto-accept
              </Button>

              <Button
                variant={selectedOption === 2 ? "default" : "outline"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={handleManualApprove}
                disabled={selectedOption !== null}
              >
                <span className="flex size-5 items-center justify-center rounded border bg-muted text-xs font-medium">
                  2
                </span>
                Yes, and manually approve edits
              </Button>

              <Button
                variant={selectedOption === 3 ? "default" : "outline"}
                size="sm"
                className="w-full justify-start gap-2"
                onClick={handleKeepPlanning}
                disabled={selectedOption !== null}
              >
                <span className="flex size-5 items-center justify-center rounded border bg-muted text-xs font-medium">
                  3
                </span>
                No, keep planning
              </Button>
            </div>

            <Input
              placeholder="Tell Clive what to do instead"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={handleFeedbackSubmit}
              disabled={selectedOption !== null}
              className="text-sm"
            />
          </CardFooter>
        </>
      )}
    </Card>
  );
};
