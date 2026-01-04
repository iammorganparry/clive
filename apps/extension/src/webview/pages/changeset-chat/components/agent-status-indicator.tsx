import type React from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@clive/ui/lib/utils";

export interface AgentStatusIndicatorProps {
  /** The current status of the agent */
  status: "thinking" | "working" | "idle";
  /** Custom message to display (overrides default) */
  message?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays the current status of the AI agent
 * Matches Claude Code's "Vibing..." style indicator
 */
export const AgentStatusIndicator: React.FC<AgentStatusIndicatorProps> = ({
  status,
  message,
  className,
}) => {
  if (status === "idle") {
    return null;
  }

  const defaultMessages: Record<"thinking" | "working", string> = {
    thinking: "Thinking...",
    working: "Working...",
  };

  const displayMessage = message || defaultMessages[status];

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground py-2 px-3",
        className,
      )}
    >
      <Sparkles
        className={cn(
          "size-4",
          status === "thinking" && "animate-pulse text-primary",
          status === "working" && "animate-spin",
        )}
      />
      <span>{displayMessage}</span>
    </div>
  );
};

AgentStatusIndicator.displayName = "AgentStatusIndicator";
