import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  X,
  Check,
  Clock,
  AlertCircle,
  Play,
  Loader2,
} from "lucide-react";
import { Button } from "@clive/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@clive/ui/card";
import { cn } from "@clive/ui";

type TerminalStatus = "pending" | "running" | "completed" | "error" | "cancelled";

interface TerminalCardProps {
  command: string;
  output?: string;
  status: TerminalStatus;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  isCancelling?: boolean;
  className?: string;
  defaultCollapsed?: boolean;
}

const statusConfig = {
  pending: {
    label: "Pending Approval",
    icon: Clock,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
  },
  running: {
    label: "Running",
    icon: Play,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  completed: {
    label: "Completed",
    icon: Check,
    color: "text-emerald-500",
    bgColor: "bg-emerald-500/10",
  },
  error: {
    label: "Error",
    icon: AlertCircle,
    color: "text-red-500",
    bgColor: "bg-red-500/10",
  },
  cancelled: {
    label: "Cancelled",
    icon: X,
    color: "text-muted-foreground",
    bgColor: "bg-muted",
  },
} as const;

export function TerminalCard({
  command,
  output = "",
  status,
  onApprove,
  onReject,
  onCancel,
  isCancelling = false,
  className,
  defaultCollapsed = false,
}: TerminalCardProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const config = statusConfig[status];
  const StatusIcon = config.icon;

  return (
<Card className={cn("border-border/40 bg-terminal rounded-none", className)}>
      <CardHeader className="px-1 py-0">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex w-full items-center gap-2 text-left transition-opacity hover:opacity-80 min-w-0"
        >
          <div className="flex-shrink-0">
            {isCollapsed ? (
              <ChevronRight className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="size-4 text-muted-foreground" />
            )}
          </div>
          <Terminal className="size-4 flex-shrink-0 text-muted-foreground" />
          <code className="text-sm font-mono text-foreground truncate min-w-0 flex-1">{command}</code>
          <div
            className={cn(
              "flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 whitespace-nowrap",
              config.bgColor,
              config.color,
            )}
          >
            <StatusIcon className="size-3" />
            <span className="hidden sm:inline">{config.label}</span>
          </div>
        </button>
      </CardHeader>

      {!isCollapsed && (
        <>
          {output && (
            <CardContent className="p-0 overflow-y-auto max-h-[200px] [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <pre className="whitespace-pre-wrap break-words text-terminal-foreground leading-snug bg-terminal">
                {output}
              </pre>
            </CardContent>
          )}

          <CardFooter className="flex items-center justify-between gap-3 bg-terminal px-2 py-1">
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "size-2 rounded-full",
                  status === "running" ? "animate-pulse bg-emerald-500" : config.color.replace("text-", "bg-"),
                )}
              />
              <span className="text-xs text-muted-foreground">{config.label}</span>
            </div>

            <div className="flex items-center gap-2">
              {status === "pending" && (
                <>
                  <Button size="sm" variant="outline" onClick={onReject} className="h-7 gap-1.5 text-xs bg-transparent">
                    <X className="size-3" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={onApprove} className="h-7 gap-1.5 text-xs">
                    <Check className="size-3" />
                    Approve
                  </Button>
                </>
              )}

              {status === "running" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isCancelling}
                  className="h-7 gap-1.5 text-xs hover:bg-destructive/10 hover:text-destructive hover:border-destructive/50 transition-colors disabled:opacity-50"
                >
                  {isCancelling ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Cancelling...
                    </>
                  ) : (
                    <>
                      <X className="size-3" />
                      Cancel
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardFooter>
        </>
      )}
    </Card>
  );
}

export type { TerminalCardProps, TerminalStatus };
