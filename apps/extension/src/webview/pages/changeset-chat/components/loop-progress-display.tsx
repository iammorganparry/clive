import type React from "react";
import { useMemo } from "react";
import {
  Queue,
  QueueSection,
  QueueSectionTrigger,
  QueueSectionLabel,
  QueueSectionContent,
  QueueList,
  QueueItem,
  QueueItemIndicator,
  QueueItemContent,
} from "@clive/ui/components/ai-elements/queue";
import { CheckCircle, Circle, Loader2, AlertCircle } from "lucide-react";
import type { LoopTodoItem, LoopProgress } from "../machines/changeset-chat-machine.js";

interface LoopProgressDisplayProps {
  todos: LoopTodoItem[];
  progress: LoopProgress | null;
  iteration: number;
  maxIterations: number;
  exitReason: string | null;
}

export const LoopProgressDisplay: React.FC<LoopProgressDisplayProps> = ({
  todos,
  progress,
  iteration,
  maxIterations,
  exitReason,
}) => {
  // Group todos by status for display
  const { completedItems, inProgressItem, pendingItems } = useMemo(() => {
    const completed: LoopTodoItem[] = [];
    let inProgress: LoopTodoItem | null = null;
    const pending: LoopTodoItem[] = [];

    for (const item of todos) {
      if (item.status === "completed") {
        completed.push(item);
      } else if (item.status === "in_progress") {
        inProgress = item;
      } else if (item.status === "pending") {
        pending.push(item);
      }
    }

    return {
      completedItems: completed,
      inProgressItem: inProgress,
      pendingItems: pending,
    };
  }, [todos]);

  if (todos.length === 0) {
    return null;
  }

  const getExitReasonLabel = (reason: string | null) => {
    switch (reason) {
      case "complete":
        return "All tasks completed";
      case "max_iterations":
        return `Stopped after ${maxIterations} iterations`;
      case "max_time":
        return "Time limit reached";
      case "error":
        return "Stopped due to error";
      case "cancelled":
        return "Cancelled by user";
      default:
        return null;
    }
  };

  const exitReasonLabel = getExitReasonLabel(exitReason);

  return (
    <div className="px-3 py-2 space-y-2">
      {/* Progress bar and iteration counter */}
      {progress && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-primary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.percentComplete}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {progress.completed}/{progress.total}
          </span>
          {iteration > 0 && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              Loop {iteration}/{maxIterations}
            </span>
          )}
        </div>
      )}

      {/* Exit reason banner */}
      {exitReason && exitReasonLabel && (
        <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
          exitReason === "complete"
            ? "bg-green-500/10 text-green-600"
            : exitReason === "cancelled"
            ? "bg-muted text-muted-foreground"
            : "bg-yellow-500/10 text-yellow-600"
        }`}>
          {exitReason === "complete" ? (
            <CheckCircle className="h-3 w-3" />
          ) : (
            <AlertCircle className="h-3 w-3" />
          )}
          {exitReasonLabel}
        </div>
      )}

      <Queue>
        {/* In Progress Section */}
        {inProgressItem && (
          <QueueSection defaultOpen={true}>
            <QueueSectionTrigger>
              <QueueSectionLabel
                icon={<Loader2 className="h-4 w-4 animate-spin" />}
                count={1}
                label="In Progress"
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                <QueueItem>
                  <QueueItemIndicator />
                  <QueueItemContent>{inProgressItem.activeForm}</QueueItemContent>
                </QueueItem>
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        )}

        {/* Pending Section */}
        {pendingItems.length > 0 && (
          <QueueSection defaultOpen={true}>
            <QueueSectionTrigger>
              <QueueSectionLabel
                icon={<Circle className="h-4 w-4" />}
                count={pendingItems.length}
                label="Todo"
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {pendingItems.map((item) => (
                  <QueueItem key={`pending-${item.content}`}>
                    <QueueItemIndicator />
                    <QueueItemContent>{item.content}</QueueItemContent>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        )}

        {/* Completed Section */}
        {completedItems.length > 0 && (
          <QueueSection defaultOpen={false}>
            <QueueSectionTrigger>
              <QueueSectionLabel
                icon={<CheckCircle className="h-4 w-4" />}
                count={completedItems.length}
                label="Completed"
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {completedItems.map((item) => (
                  <QueueItem key={`completed-${item.content}`}>
                    <QueueItemIndicator completed />
                    <QueueItemContent completed>{item.content}</QueueItemContent>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        )}
      </Queue>
    </div>
  );
};
