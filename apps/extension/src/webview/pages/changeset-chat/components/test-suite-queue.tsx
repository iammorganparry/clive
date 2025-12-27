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
  QueueItemDescription,
} from "@clive/ui/components/ai-elements/queue";
import { CheckCircle, Circle, Loader2, ChevronDownIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@clive/ui/collapsible";
import type { TestSuiteQueueItem } from "../machines/changeset-chat-machine.js";
import { TestResultsList } from "./test-results-list.js";

interface TestSuiteQueueProps {
  queue: TestSuiteQueueItem[];
  currentSuiteId: string | null;
}

export const TestSuiteQueue: React.FC<TestSuiteQueueProps> = ({
  queue,
  currentSuiteId,
}) => {
  const { completedItems, inProgressItem, pendingItems } = useMemo(() => {
    const completed: TestSuiteQueueItem[] = [];
    let inProgress: TestSuiteQueueItem | null = null;
    const pending: TestSuiteQueueItem[] = [];

    for (const item of queue) {
      if (item.status === "completed" || item.status === "failed") {
        completed.push(item);
      } else if (item.status === "in_progress" || item.id === currentSuiteId) {
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
  }, [queue, currentSuiteId]);

  if (queue.length === 0) {
    return null;
  }

  return (
    <Queue className="mt-4">
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
                <Collapsible key={item.id} defaultOpen={false}>
                  <CollapsibleTrigger asChild>
                    <QueueItem className="cursor-pointer">
                      <QueueItemIndicator completed={item.status === "completed"} />
                      <div className="flex-1">
                        <QueueItemContent completed={item.status === "completed"}>
                          {item.name}
                        </QueueItemContent>
                        {item.targetFilePath && (
                          <QueueItemDescription completed={item.status === "completed"}>
                            {item.targetFilePath}
                          </QueueItemDescription>
                        )}
                        {item.testResults && (
                          <TestResultsList
                            testResults={item.testResults}
                            expanded={false}
                          />
                        )}
                      </div>
                      {item.testResults && item.testResults.tests.length > 0 && (
                        <ChevronDownIcon className="size-3 text-muted-foreground shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                      )}
                    </QueueItem>
                  </CollapsibleTrigger>
                  {item.testResults && item.testResults.tests.length > 0 && (
                    <CollapsibleContent>
                      <div className="ml-4">
                        <TestResultsList
                          testResults={item.testResults}
                          expanded={true}
                        />
                      </div>
                    </CollapsibleContent>
                  )}
                </Collapsible>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      )}

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
            <div className="space-y-2">
              <QueueItem>
                <QueueItemIndicator />
                <div className="flex-1">
                  <QueueItemContent>{inProgressItem.name}</QueueItemContent>
                  {inProgressItem.targetFilePath && (
                    <QueueItemDescription>
                      {inProgressItem.targetFilePath}
                    </QueueItemDescription>
                  )}
                </div>
              </QueueItem>
              {/* Show test results if available */}
              {inProgressItem.testResults && (
                <TestResultsList
                  testResults={inProgressItem.testResults}
                  expanded={true}
                />
              )}
            </div>
          </QueueSectionContent>
        </QueueSection>
      )}

      {/* Todo Section */}
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
                <QueueItem key={item.id}>
                  <QueueItemIndicator />
                  <div className="flex-1">
                    <QueueItemContent>{item.name}</QueueItemContent>
                    {item.targetFilePath && (
                      <QueueItemDescription>
                        {item.targetFilePath}
                      </QueueItemDescription>
                    )}
                  </div>
                </QueueItem>
              ))}
            </QueueList>
          </QueueSectionContent>
        </QueueSection>
      )}
    </Queue>
  );
};

