import type React from "react";
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
import { FileTextIcon, CheckCircle2Icon } from "lucide-react";
import {
  groupTodosBySection,
  type ScratchpadTodo,
} from "../utils/parse-scratchpad.js";

interface ScratchpadQueueProps {
  todos: ScratchpadTodo[];
}

export const ScratchpadQueue: React.FC<ScratchpadQueueProps> = ({ todos }) => {
  if (todos.length === 0) {
    return null;
  }

  const groupedTodos = groupTodosBySection(todos);

  // Prioritize certain sections
  const sectionOrder = ["Files to Analyze", "Progress", "Current Focus"];
  const orderedSections = [
    ...sectionOrder.filter((s) => groupedTodos[s]),
    ...Object.keys(groupedTodos).filter((s) => !sectionOrder.includes(s)),
  ];

  return (
    <Queue>
      {orderedSections.map((sectionName) => {
        const sectionTodos = groupedTodos[sectionName];
        if (!sectionTodos || sectionTodos.length === 0) {
          return null;
        }

        const totalCount = sectionTodos.length;

        return (
          <QueueSection key={sectionName} defaultOpen={true}>
            <QueueSectionTrigger>
              <QueueSectionLabel
                label={sectionName}
                count={totalCount}
                icon={
                  sectionName === "Files to Analyze" ? (
                    <FileTextIcon className="size-4" />
                  ) : (
                    <CheckCircle2Icon className="size-4" />
                  )
                }
              />
            </QueueSectionTrigger>
            <QueueSectionContent>
              <QueueList>
                {sectionTodos.map((todo) => (
                  <QueueItem key={todo.id}>
                    <QueueItemIndicator completed={todo.completed} />
                    <QueueItemContent completed={todo.completed}>
                      {todo.title}
                    </QueueItemContent>
                  </QueueItem>
                ))}
              </QueueList>
            </QueueSectionContent>
          </QueueSection>
        );
      })}
    </Queue>
  );
};
