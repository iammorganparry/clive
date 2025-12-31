import type React from "react";
import { Check } from "lucide-react";
import { Button } from "@clive/ui/button";
import { cn } from "@clive/ui/lib/utils";

interface FloatingApprovalBarProps {
  isVisible: boolean;
  onApprove: () => void;
  suiteCount?: number;
}

export const FloatingApprovalBar: React.FC<FloatingApprovalBarProps> = ({
  isVisible,
  onApprove,
  suiteCount = 0,
}) => {
  if (!isVisible) {
    return null;
  }

  const suiteText = suiteCount === 1 ? "suite" : "suites";

  return (
    <div
      className={cn(
        "sticky bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "px-3 py-2 shadow-lg",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {suiteCount} test {suiteText} ready
        </span>
        <Button
          size="sm"
          variant="default"
          onClick={onApprove}
          className="gap-1.5"
        >
          <Check className="size-3" />
          Write Tests
        </Button>
      </div>
    </div>
  );
};
