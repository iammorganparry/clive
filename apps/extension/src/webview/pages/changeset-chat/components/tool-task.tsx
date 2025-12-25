import type React from "react";
import {
  Terminal,
  Search,
  FileCode,
  FilePlus,
  BookOpen,
  BookPlus,
  Globe,
  WrenchIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Task, TaskTrigger, TaskContent, TaskItem } from "@clive/ui/task";
import { Badge } from "@clive/ui/badge";
import { CodeBlock } from "@clive/ui/components/ai-elements/code-block";
import type { ToolState } from "../../../types/chat.js";
import { cn } from "@clive/ui/lib/utils";

interface ToolTaskProps {
  toolName: string;
  toolCallId: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

const toolDisplayConfig: Record<
  string,
  { title: string; description: string; icon: LucideIcon }
> = {
  bashExecute: {
    title: "Running Command",
    description: "Executing shell command",
    icon: Terminal,
  },
  semanticSearch: {
    title: "Searching Codebase",
    description: "Finding relevant code",
    icon: Search,
  },
  proposeTest: {
    title: "Proposing Test",
    description: "Generating test proposal",
    icon: FileCode,
  },
  writeTestFile: {
    title: "Writing Test File",
    description: "Creating test file",
    icon: FilePlus,
  },
  searchKnowledge: {
    title: "Searching Knowledge Base",
    description: "Finding testing patterns",
    icon: BookOpen,
  },
  writeKnowledgeFile: {
    title: "Updating Knowledge Base",
    description: "Recording insights",
    icon: BookPlus,
  },
  webSearch: {
    title: "Searching Web",
    description: "Looking up documentation",
    icon: Globe,
  },
};

const getStatusBadge = (state: ToolState) => {
  const labels: Record<ToolState, string> = {
    "input-streaming": "Pending",
    "input-available": "Running",
    "output-available": "Completed",
    "output-error": "Error",
  };

  const variants: Record<ToolState, "secondary" | "destructive"> = {
    "input-streaming": "secondary",
    "input-available": "secondary",
    "output-available": "secondary",
    "output-error": "destructive",
  };

  return (
    <Badge variant={variants[state]} className="text-xs">
      {labels[state]}
    </Badge>
  );
};

export const ToolTask: React.FC<ToolTaskProps> = ({
  toolName,
  state,
  input,
  output,
  errorText,
}) => {
  const config =
    toolDisplayConfig[toolName] ??
    ({ title: toolName, description: "", icon: WrenchIcon } as {
      title: string;
      description: string;
      icon: LucideIcon;
    });
  const Icon = config.icon;

  // Extract command for bashExecute
  const command =
    toolName === "bashExecute" &&
    input &&
    typeof input === "object" &&
    "command" in input
      ? String(input.command)
      : null;

  return (
    <Task>
      <TaskTrigger title={config.title}>
        <div className="flex items-center gap-2">
          <Icon className="size-4" />
          <span>{config.title}</span>
          {getStatusBadge(state)}
        </div>
      </TaskTrigger>
      <TaskContent>
        {command ? (
          <TaskItem>
            <div className="space-y-2">
              <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                Command
              </h4>
              <div className="rounded-md bg-muted/50 p-2 font-mono text-xs">
                <pre className="whitespace-pre-wrap break-words">{command}</pre>
              </div>
            </div>
          </TaskItem>
        ) : (
          <TaskItem>{config.description}</TaskItem>
        )}
        {input !== undefined && input !== null && (
          <div className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Parameters
            </h4>
            <div className="rounded-md bg-muted/50">
              <CodeBlock
                code={JSON.stringify(input, null, 2)}
                language="json"
              />
            </div>
          </div>
        )}
        {(output !== undefined || errorText !== undefined) && (
          <div className="space-y-2">
            <h4 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {errorText ? "Error" : "Result"}
            </h4>
            <div
              className={cn(
                "overflow-x-auto rounded-md text-xs",
                errorText
                  ? "bg-destructive/10 text-destructive"
                  : "bg-muted/50 text-foreground",
              )}
            >
              {errorText !== undefined && (
                <div className="p-2">{String(errorText)}</div>
              )}
              {output !== undefined && output !== null && (
                <div className="p-2">
                  {typeof output === "string" ? (
                    <pre className="whitespace-pre-wrap break-words text-xs">
                      {output}
                    </pre>
                  ) : (
                    <CodeBlock
                      code={JSON.stringify(output, null, 2)}
                      language="json"
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </TaskContent>
    </Task>
  );
};
