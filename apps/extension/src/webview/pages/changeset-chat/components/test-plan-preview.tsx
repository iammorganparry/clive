import type React from "react";
import {
  Plan,
  PlanHeader,
  PlanTitle,
  PlanDescription,
  PlanContent,
  PlanTrigger,
} from "@clive/ui/components/ai-elements/plan";
import { Streamdown } from "streamdown";
import { cn } from "@clive/ui/lib/utils";
import type { ParsedPlan } from "../utils/parse-plan.js";

export interface TestPlanPreviewProps {
  plan: ParsedPlan;
  isStreaming?: boolean;
  className?: string;
}

export const TestPlanPreview: React.FC<TestPlanPreviewProps> = ({
  plan,
  isStreaming = false,
  className,
}) => {
  return (
    <Plan
      defaultOpen={true}
      isStreaming={isStreaming}
      className={cn("w-full", className)}
    >
      <PlanHeader>
        <div className="flex-1">
          <PlanTitle>{plan.title}</PlanTitle>
          {plan.description && (
            <PlanDescription>{plan.description}</PlanDescription>
          )}
        </div>
        <PlanTrigger />
      </PlanHeader>
      <PlanContent>
        <Streamdown
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          )}
        >
          {plan.body}
        </Streamdown>
      </PlanContent>
    </Plan>
  );
};
