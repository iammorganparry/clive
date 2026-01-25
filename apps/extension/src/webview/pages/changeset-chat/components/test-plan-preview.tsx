import { Button } from "@clive/ui/button";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@clive/ui/components/ai-elements/plan";
import { cn } from "@clive/ui/lib/utils";
import type React from "react";
import { useCallback } from "react";
import { Streamdown } from "streamdown";
import { useRpc } from "../../../rpc/provider.js";
import type { ParsedPlan } from "../utils/parse-plan.js";

export interface TestPlanPreviewProps {
  plan: ParsedPlan;
  isStreaming?: boolean;
  className?: string;
  filePath?: string | null;
}

export const TestPlanPreview: React.FC<TestPlanPreviewProps> = ({
  plan,
  isStreaming = false,
  className,
  filePath,
}) => {
  const rpc = useRpc();
  const openFileMutation = rpc.system.openFile.useMutation();

  const truncatedBody = `${plan.body.split("\n").slice(0, 10).join("\n")}...`;

  const handleReadMore = useCallback(() => {
    if (filePath) {
      openFileMutation.mutate({ filePath });
    }
  }, [filePath, openFileMutation]);

  return (
    <Plan
      defaultOpen={true}
      isStreaming={isStreaming}
      className={cn("w-full", className)}
    >
      <PlanHeader>
        <div className="flex-1 space-y-1">
          <PlanTitle>{plan.title}</PlanTitle>
          <PlanDescription>{plan.description}</PlanDescription>
        </div>

        {filePath && (
          <PlanAction>
            <Button
              variant="outline"
              size="sm"
              onClick={handleReadMore}
              disabled={openFileMutation.isPending}
            >
              Read More
            </Button>
          </PlanAction>
        )}
        <PlanTrigger />
      </PlanHeader>
      <PlanContent>
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          )}
        >
          {truncatedBody}
        </Streamdown>
      </PlanContent>
    </Plan>
  );
};
