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
import { Badge } from "@clive/ui/badge";
import { cn } from "@clive/ui/lib/utils";
import type { ToolState } from "../../../types/chat.js";

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  input?: unknown;
  errorText?: string;
}

const toolDisplayConfig: Record<string, { title: string; icon: LucideIcon }> = {
  bashExecute: {
    title: "Running Command",
    icon: Terminal,
  },
  semanticSearch: {
    title: "Searching Codebase",
    icon: Search,
  },
  proposeTest: {
    title: "Proposing Test",
    icon: FileCode,
  },
  writeTestFile: {
    title: "Writing Test File",
    icon: FilePlus,
  },
  searchKnowledge: {
    title: "Searching Knowledge Base",
    icon: BookOpen,
  },
  writeKnowledgeFile: {
    title: "Updating Knowledge Base",
    icon: BookPlus,
  },
  webSearch: {
    title: "Searching Web",
    icon: Globe,
  },
};

// Type guards for input structures
interface BashExecuteArgs {
  command: string;
}

const isBashExecuteArgs = (input: unknown): input is BashExecuteArgs =>
  typeof input === "object" &&
  input !== null &&
  "command" in input &&
  typeof (input as BashExecuteArgs).command === "string";

interface SemanticSearchArgs {
  query: string;
  limit?: number;
}

const isSemanticSearchArgs = (input: unknown): input is SemanticSearchArgs =>
  typeof input === "object" &&
  input !== null &&
  "query" in input &&
  typeof (input as SemanticSearchArgs).query === "string";

interface ProposeTestArgs {
  sourceFile?: string;
  testStrategies?: unknown[];
}

const isProposeTestArgs = (input: unknown): input is ProposeTestArgs =>
  typeof input === "object" && input !== null && "sourceFile" in input;

interface WriteTestFileArgs {
  filePath?: string;
  targetTestPath?: string;
}

const isWriteTestFileArgs = (input: unknown): input is WriteTestFileArgs =>
  typeof input === "object" && input !== null;

interface SearchKnowledgeArgs {
  query?: string;
  category?: string;
}

const isSearchKnowledgeArgs = (input: unknown): input is SearchKnowledgeArgs =>
  typeof input === "object" && input !== null;

interface WriteKnowledgeFileArgs {
  filePath?: string;
  category?: string;
  topic?: string;
}

const isWriteKnowledgeFileArgs = (
  input: unknown,
): input is WriteKnowledgeFileArgs =>
  typeof input === "object" && input !== null;

interface WebSearchArgs {
  query?: string;
}

const isWebSearchArgs = (input: unknown): input is WebSearchArgs =>
  typeof input === "object" && input !== null;

/**
 * Extracts filename from a full path
 */
const extractFilename = (path: string): string => {
  // Handle both forward and backslashes
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

/**
 * Formats tool input into a user-friendly display string
 */
const formatToolInput = (toolName: string, input: unknown): string | null => {
  if (!input || typeof input !== "object") {
    return null;
  }

  switch (toolName) {
    case "bashExecute": {
      if (isBashExecuteArgs(input)) {
        const command = input.command.trim();
        // Extract filename from cat commands
        if (command.startsWith("cat ")) {
          const filePath = command
            .replace(/^cat\s+/, "")
            .split(/\s+/)[0]
            .replace(/['"]/g, "");
          const filename = extractFilename(filePath);
          return `cat ${filename}`;
        }
        // Truncate long commands
        return command.length > 60 ? `${command.slice(0, 57)}...` : command;
      }
      break;
    }

    case "semanticSearch": {
      if (isSemanticSearchArgs(input)) {
        return input.query;
      }
      break;
    }

    case "proposeTest": {
      if (isProposeTestArgs(input) && input.sourceFile) {
        return extractFilename(input.sourceFile);
      }
      break;
    }

    case "writeTestFile": {
      if (isWriteTestFileArgs(input)) {
        const path = input.filePath || input.targetTestPath;
        return path ? extractFilename(path) : null;
      }
      break;
    }

    case "searchKnowledge": {
      if (isSearchKnowledgeArgs(input)) {
        return input.query || input.category || null;
      }
      break;
    }

    case "writeKnowledgeFile": {
      if (isWriteKnowledgeFileArgs(input)) {
        if (input.filePath) {
          return extractFilename(input.filePath);
        }
        return input.category || input.topic || null;
      }
      break;
    }

    case "webSearch": {
      if (isWebSearchArgs(input) && input.query) {
        return input.query;
      }
      break;
    }
  }

  // Default: try to extract first meaningful string value
  const obj = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string" && value.length > 0) {
      // Skip common metadata fields
      if (!["limit", "offset", "maxResults", "timeout"].includes(key)) {
        return value.length > 60 ? `${value.slice(0, 57)}...` : value;
      }
    }
  }

  return null;
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

export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  state,
  input,
  errorText,
}) => {
  const config =
    toolDisplayConfig[toolName] ??
    ({ title: toolName, icon: WrenchIcon } as {
      title: string;
      icon: LucideIcon;
    });
  const Icon = config.icon;

  const formattedInput = formatToolInput(toolName, input);
  const hasError = state === "output-error" || !!errorText;

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        hasError
          ? "border-destructive/50 bg-destructive/5"
          : "border-border bg-muted/30",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="font-medium">{config.title}</span>
      {formattedInput && (
        <>
          <span className="text-muted-foreground">•</span>
          <span className="truncate text-muted-foreground text-xs">
            {formattedInput}
          </span>
        </>
      )}
      <div className="ml-auto shrink-0">{getStatusBadge(state)}</div>
    </div>
  );
};
