import type React from "react";
import { Check } from "lucide-react";
import { Button } from "@clive/ui/button";
import { cn } from "@clive/ui/lib/utils";

interface FloatingApprovalBarProps {
  isVisible: boolean;
  onApprove: () => void;
}

export const FloatingApprovalBar: React.FC<FloatingApprovalBarProps> = ({
  isVisible,
  onApprove,
}) => {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        "sticky bottom-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        "px-4 py-3 shadow-lg",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 text-sm text-muted-foreground">
          Review the test strategy above. Click approve to write tests, or type
          below to request changes.
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={onApprove}
            className="gap-1.5"
          >
            <Check className="size-3" />
            Approve & Write Tests
          </Button>
        </div>
      </div>
    </div>
  );
};
