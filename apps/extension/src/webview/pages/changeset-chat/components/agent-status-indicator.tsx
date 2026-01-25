import { cn } from "@clive/ui/lib/utils";
import type React from "react";

export interface AgentStatusIndicatorProps {
  /** Additional CSS classes */
  className?: string;
}

/**
 * Displays three bouncing dots to indicate the AI agent is generating a response
 */
export const AgentStatusIndicator: React.FC<AgentStatusIndicatorProps> = ({
  className,
}) => (
  <div className={cn("flex items-center gap-1 py-2 px-3", className)}>
    <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
    <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
    <span className="size-1.5 rounded-full bg-muted-foreground animate-bounce" />
  </div>
);

AgentStatusIndicator.displayName = "AgentStatusIndicator";
