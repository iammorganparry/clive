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
import { CheckCircle, Circle, Loader2, ChevronDownIcon, X, } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@clive/ui/collapsible";
import type { TestSuiteQueueItem } from "../machines/changeset-chat-machine.js";
import { TestResultsList } from "./test-results-list.js";
import { Button } from "@clive/ui/button";

interface TestSuiteQueueProps {
  queue: TestSuiteQueueItem[];
  currentSuiteId: string | null;
  onSkipSuite?: (suiteId: string) => void;
}

export const TestSuiteQueue: React.FC<TestSuiteQueueProps> = ({
  queue,
  currentSuiteId,
  onSkipSuite,
}) => {
  const { completedItems, inProgressItem, pendingItems, skippedItems } = useMemo(() => {
    const completed: TestSuiteQueueItem[] = [];
    let inProgress: TestSuiteQueueItem | null = null;
    const pending: TestSuiteQueueItem[] = [];
    const skipped: TestSuiteQueueItem[] = [];

    for (const item of queue) {
      if (item.status === "completed" || item.status === "failed") {
        completed.push(item);
      } else if (item.status === "in_progress" || item.id === currentSuiteId) {
        inProgress = item;
      } else if (item.status === "pending") {
        pending.push(item);
      } else if (item.status === "skipped") {
        skipped.push(item);
      }
    }

    return {
      completedItems: completed,
      inProgressItem: inProgress,
      pendingItems: pending,
      skippedItems: skipped,
    };
  }, [queue, currentSuiteId]);

  if (queue.length === 0) {
    return null;
  }

  return (
    <Queue className="border-none py-1 px-0 m-0">
      {/* Completed Section */}
      {completedItems.length > 0 && (
        <QueueSection defaultOpen={false}>
          <QueueSectionTrigger className="px-0">
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
                    <QueueItem className="cursor-pointer flex-col items-start px-0">
                      <div className="flex items-center flex-row w-full gap-2">
                      <QueueItemIndicator completed={item.status === "completed"} />
                        <QueueItemContent completed={item.status === "completed"}>
                          {item.name}
                        </QueueItemContent>
                        {item.testResults && item.testResults.tests.length > 0 && (
                          <ChevronDownIcon className="ml-auto size-3 text-muted-foreground shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                        )}
                      </div>
                      <div className="flex flex-col ml-6 w-full">
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
          <QueueSectionTrigger className="px-0">
            <QueueSectionLabel
              icon={<Loader2 className="h-4 w-4 animate-spin" />}
              count={1}
              label="In Progress"
            />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <div className="space-y-2">
              <QueueItem className="flex-col items-start px-0">
                <div className="flex items-center flex-row w-full gap-2">
                <QueueItemIndicator />
                  <QueueItemContent>{inProgressItem.name}</QueueItemContent>
                </div>
                <div className="flex flex-col ml-6 w-full">
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
          <QueueSectionTrigger className="px-0">
            <QueueSectionLabel
              icon={<Circle className="h-4 w-4" />}
              count={pendingItems.length}
              label="Todo"
            />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList>
              {pendingItems.map((item) => (
                <QueueItem key={item.id} className="flex-col items-start px-0">
                  <div className="flex items-center flex-row w-full gap-2">
                  <QueueItemIndicator />
                    <QueueItemContent>{item.name}</QueueItemContent>
                    {onSkipSuite && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="ml-auto shrink-0"
                        onClick={() => onSkipSuite(item.id)}
                        aria-label="Skip suite"
                      >
                        <X className="size-3" />
                      </Button>
                    )}
                  </div>
                  <div className="flex flex-col ml-6 w-full">
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

      {/* Skipped Section */}
      {skippedItems.length > 0 && (
        <QueueSection defaultOpen={false}>
          <QueueSectionTrigger className="px-0">
            <QueueSectionLabel
              icon={<X className="h-4 w-4" />}
              count={skippedItems.length}
              label="Skipped"
            />
          </QueueSectionTrigger>
          <QueueSectionContent>
            <QueueList>
              {skippedItems.map((item) => (
                <QueueItem key={item.id} className="flex-col items-start px-0 opacity-50">
                  <div className="flex items-center flex-row w-full gap-2">
                    <QueueItemIndicator />
                    <QueueItemContent>{item.name}</QueueItemContent>
                  </div>
                  <div className="flex flex-col ml-6 w-full">
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

