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
import { FileCodeBlock } from "@clive/ui/components/ai-elements/file-code-block";
import type { ToolState } from "../../../types/chat.js";

// Type guards and interfaces for output types
interface BashExecuteArgs {
  command: string;
}

const isBashExecuteArgs = (input: unknown): input is BashExecuteArgs =>
  typeof input === "object" &&
  input !== null &&
  "command" in input &&
  typeof (input as BashExecuteArgs).command === "string";

interface BashOutput {
  stdout: string;
  wasTruncated?: boolean;
}

const isBashOutput = (value: unknown): value is BashOutput =>
  typeof value === "object" &&
  value !== null &&
  "stdout" in value &&
  typeof (value as BashOutput).stdout === "string";

interface SemanticSearchResult {
  filePath: string;
  content: string;
  similarity?: number;
}

interface SemanticSearchOutput {
  results: SemanticSearchResult[];
}

const isSemanticSearchOutput = (
  value: unknown,
): value is SemanticSearchOutput =>
  typeof value === "object" &&
  value !== null &&
  "results" in value &&
  Array.isArray((value as SemanticSearchOutput).results);

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

  // Extract command for bashExecute with type guard
  const command =
    toolName === "bashExecute" && isBashExecuteArgs(input)
      ? input.command
      : null;

  // Check if bashExecute command is a cat command
  const isCatCommand = command?.trim().startsWith("cat ");
  const catFileName =
    isCatCommand && command !== null
      ? command
          .trim()
          .replace(/^cat\s+/, "")
          .split(/\s+/)[0]
          .replace(/['"]/g, "")
      : null;

  // Check if output is semanticSearch results with type guard
  const semanticSearchOutput =
    toolName === "semanticSearch" && isSemanticSearchOutput(output)
      ? output
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
            {errorText !== undefined && (
              <div className="rounded-md bg-destructive/10 p-2 text-destructive text-xs">
                {String(errorText)}
              </div>
            )}
            {output !== undefined && output !== null && !errorText && (
              <div className="space-y-4">
                {/* Render semanticSearch results as file blocks */}
                {semanticSearchOutput?.results.map((result, index) => (
                  <FileCodeBlock
                    key={`${result.filePath}-${index}`}
                    code={result.content}
                    filePath={result.filePath}
                    badge={
                      result.similarity !== undefined
                        ? Math.round(result.similarity * 100)
                        : undefined
                    }
                  />
                ))}
                {/* Render bashExecute cat output as file block */}
                {!semanticSearchOutput &&
                  isCatCommand &&
                  catFileName !== null &&
                  isBashOutput(output) &&
                  output.stdout.trim().length > 0 && (
                    <FileCodeBlock
                      code={output.stdout}
                      filePath={catFileName}
                      badge={output.wasTruncated ? "truncated" : undefined}
                    />
                  )}
                {/* Fallback to default rendering for other outputs */}
                {!semanticSearchOutput &&
                  !(isCatCommand && catFileName !== null) &&
                  (typeof output === "string" ? (
                    <div className="rounded-md bg-muted/50 p-2">
                      <pre className="whitespace-pre-wrap break-words text-xs">
                        {output}
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/50">
                      <CodeBlock
                        code={JSON.stringify(output, null, 2)}
                        language="json"
                      />
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
      </TaskContent>
    </Task>
  );
};
