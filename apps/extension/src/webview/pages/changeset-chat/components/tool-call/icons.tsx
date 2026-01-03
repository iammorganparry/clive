import type React from "react";
import {
  BookOpenIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  CodeIcon,
  FileCheckIcon,
  FileTextIcon,
  GlobeIcon,
  SearchIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react";
import type { ToolState } from "../../../../types/chat.js";

/**
 * Get icon for tool type
 */
export const getToolIcon = (toolName: string): React.ReactNode => {
  const iconClass = "size-4";

  switch (toolName) {
    // Internal tool names
    case "readFile":
    case "read_file":
    case "Read": // CLI tool name
      return <FileTextIcon className={iconClass} />;
    case "bashExecute":
    case "Bash": // CLI tool name
      return <TerminalIcon className={iconClass} />;
    case "codebaseSearch":
    case "Grep": // CLI tool name
      return <SearchIcon className={iconClass} />;
    case "Glob": // CLI tool name
      return <SearchIcon className={iconClass} />;
    case "searchKnowledge":
      return <BookOpenIcon className={iconClass} />;
    case "writeTestFile":
    case "Write": // CLI tool name
      return <FileCheckIcon className={iconClass} />;
    case "writeKnowledgeFile":
      return <FileTextIcon className={iconClass} />;
    case "proposeTest":
      return <FileCheckIcon className={iconClass} />;
    case "webSearch":
      return <GlobeIcon className={iconClass} />;
    case "editFileContent":
    case "Edit": // CLI tool name
      return <FileTextIcon className={iconClass} />;
    default:
      return <CodeIcon className={iconClass} />;
  }
};

/**
 * Get status badge for tool state
 */
export const getStatusBadge = (state: ToolState): React.ReactNode | null => {
  const icons: Record<ToolState, React.ReactNode> = {
    "input-streaming": <CircleIcon className="size-3" />,
    "input-available": <ClockIcon className="size-3 animate-pulse" />,
    "approval-requested": null,
    "output-available": <CheckCircleIcon className="size-3 text-green-600" />,
    "output-error": <XCircleIcon className="size-3 text-red-600" />,
    "output-denied": (
      <div className="flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5">
        <XCircleIcon className="size-3 text-red-600 dark:text-red-400" />
        <span className="text-xs font-medium text-red-700 dark:text-red-300">Rejected</span>
      </div>
    ),
    "output-cancelled": (
      <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
        <XCircleIcon className="size-3 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Cancelled</span>
      </div>
    ),
  };

  if (
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied" ||
    state === "output-cancelled"
  ) {
    return <div className="flex items-center">{icons[state]}</div>;
  }

  return null;
};
