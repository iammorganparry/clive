import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@clive/ui/components/ai-elements/code-block";
import { Button } from "@clive/ui/button";
import { cn } from "@clive/ui/lib/utils";
import {
  Task,
  TaskContent,
  TaskItem,
  TaskItemFile,
  TaskTrigger,
} from "@clive/ui/task";
import { Icon, addCollection } from "@iconify/react";
// Import vscode-icons for offline use (required for VS Code webview CSP)
import vscodeIconsData from "@iconify-json/vscode-icons/icons.json";
import {
  BookOpenIcon,
  CheckCircleIcon,
  ChevronDownIcon,
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
import type React from "react";
import { useCallback } from "react";
import type { BundledLanguage } from "shiki";
import { getVSCodeAPI } from "../../../services/vscode.js";
import type { ToolState } from "../../../types/chat.js";
import { useRpc } from "../../../rpc/provider.js";

// Add vscode-icons collection for offline use (works with VS Code webview CSP)
addCollection(vscodeIconsData);

interface ToolCallCardProps {
  toolName: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  streamingContent?: string; // For file-writing tools that stream content
  toolCallId?: string;
  subscriptionId?: string;
}

// Tool display config removed - using natural language summaries instead

// Type guards for input structures
interface BashExecuteArgs {
  command: string;
}

const isBashExecuteArgs = (input: unknown): input is BashExecuteArgs =>
  typeof input === "object" &&
  input !== null &&
  "command" in input &&
  typeof (input as BashExecuteArgs).command === "string";

interface ProposeTestArgs {
  sourceFile?: string;
  testStrategies?: unknown[];
}

const isProposeTestArgs = (input: unknown): input is ProposeTestArgs =>
  typeof input === "object" && input !== null && "sourceFile" in input;

interface WriteTestFileArgs {
  filePath?: string;
  targetTestPath?: string;
  targetPath?: string;
  testContent?: string;
}

const isWriteTestFileArgs = (input: unknown): input is WriteTestFileArgs =>
  typeof input === "object" && input !== null;

interface WriteTestFileOutput {
  success?: boolean;
  filePath?: string;
  path?: string;
  message?: string;
}

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
  content?: string;
}

const isWriteKnowledgeFileArgs = (
  input: unknown,
): input is WriteKnowledgeFileArgs =>
  typeof input === "object" && input !== null;

interface WriteKnowledgeFileOutput {
  success?: boolean;
  path?: string;
  relativePath?: string;
  error?: string;
}

interface WebSearchArgs {
  query?: string;
}

const isWebSearchArgs = (input: unknown): input is WebSearchArgs =>
  typeof input === "object" && input !== null;

interface ReadFileArgs {
  filePath?: string;
  targetPath?: string;
}

const isReadFileArgs = (input: unknown): input is ReadFileArgs =>
  typeof input === "object" && input !== null;

interface ReplaceInFileArgs {
  targetPath?: string;
  filePath?: string;
  diff?: string;
}

const isReplaceInFileArgs = (input: unknown): input is ReplaceInFileArgs =>
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
 * Generate natural language summary for tool header
 * Returns a concise description of what the tool did
 */
const generateToolSummary = (
  toolName: string,
  input?: unknown,
  output?: unknown,
): string => {
  // bashExecute: Show the command with smart formatting
  if (toolName === "bashExecute" && isBashExecuteArgs(input)) {
    const command = input.command.trim();
    // Extract filename from cat commands for cleaner display
    if (command.startsWith("cat ")) {
      const filePath = command
        .replace(/^cat\s+/, "")
        .split(/\s+/)[0]
        .replace(/['"]/g, "");
      const filename = extractFilename(filePath);
      return `cat ${filename}`;
    }
    // For find commands, try to extract directory
    if (command.startsWith("find ")) {
      const match = command.match(/find\s+([^\s]+)/);
      if (match) {
        const dir = extractFilename(match[1]);
        return `find ${dir}`;
      }
      return "find files";
    }
    // For grep commands, show "Grepped <pattern> in <directory>" format
    if (command.startsWith("grep ")) {
      // Extract pattern (could be quoted or unquoted)
      const patternMatch = command.match(/grep\s+(?:-r\s+)?(?:['"]([^'"]+)['"]|([^\s]+))/);
      const pattern = patternMatch?.[1] || patternMatch?.[2] || "";
      
      // Extract directory/path (usually after pattern)
      const pathMatch = command.match(/grep\s+(?:-r\s+)?(?:['"][^'"]+['"]|[^\s]+)\s+([^\s]+)/);
      const path = pathMatch?.[1] || "";
      
      if (pattern && path) {
        const dirName = extractFilename(path);
        return `Grepped ${pattern} in ${dirName}`;
      } else if (pattern) {
        return `Grepped ${pattern}`;
      }
      return "grep";
    }
    // For git commands, show simplified version
    if (command.startsWith("git ")) {
      const parts = command.split(/\s+/);
      if (parts.length > 1) {
        return `git ${parts[1]}`;
      }
      return "git";
    }
    // Truncate long commands but preserve readability
    return command.length > 50 ? `${command.slice(0, 47)}...` : command;
  }

  // read_file: Show "Read <filename>"
  if (toolName === "read_file") {
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) {
        const filename = extractFilename(path);
        // Check if output has line range info
        if (output && typeof output === "object") {
          const fileOutput = output as { startLine?: number; endLine?: number };
          if (fileOutput.startLine && fileOutput.endLine) {
            return `Read ${filename} L${fileOutput.startLine}-${fileOutput.endLine}`;
          }
        }
        return `Read ${filename}`;
      }
    }
    return "Read file";
  }

  // searchKnowledge: Show query or result count
  if (toolName === "searchKnowledge") {
    if (output && typeof output === "object") {
      const searchOutput = output as { count?: number; results?: unknown[] };
      const count = searchOutput.count ?? searchOutput.results?.length ?? 0;
      if (isSearchKnowledgeArgs(input) && input.query) {
        return count > 0
          ? `Found ${count} result${count !== 1 ? "s" : ""} for "${input.query}"`
          : `No results for "${input.query}"`;
      }
    }
    if (isSearchKnowledgeArgs(input)) {
      return input.query
        ? `Searching "${input.query}"`
        : input.category
          ? `Searching category: ${input.category}`
          : "Searching knowledge base";
    }
    return "Searching knowledge base";
  }

  // writeTestFile: Show filename (handled separately in component)
  if (toolName === "writeTestFile") {
    if (isWriteTestFileArgs(input)) {
      const path = input.filePath || input.targetTestPath || input.targetPath;
      if (path) {
        return extractFilename(path);
      }
    }
    return "Writing test file";
  }

  // writeKnowledgeFile: Show filename (handled separately in component)
  if (toolName === "writeKnowledgeFile") {
    if (isWriteKnowledgeFileArgs(input)) {
      if (input.filePath) {
        return extractFilename(input.filePath);
      }
      return input.category || input.topic || "Writing knowledge file";
    }
    return "Writing knowledge file";
  }

  // proposeTest: Show source file
  if (toolName === "proposeTest") {
    if (isProposeTestArgs(input) && input.sourceFile) {
      return `Proposing test for ${extractFilename(input.sourceFile)}`;
    }
    return "Proposing test";
  }

  // webSearch: Show query
  if (toolName === "webSearch") {
    if (isWebSearchArgs(input) && input.query) {
      return `Searching web: ${input.query}`;
    }
    return "Searching web";
  }

  // replaceInFile: Show "Edit <filename>"
  if (toolName === "replaceInFile") {
    if (isReplaceInFileArgs(input)) {
      const path = input.targetPath || input.filePath;
      if (path) {
        const filename = extractFilename(path);
        return `Edit ${filename}`;
      }
    }
    return "Edit file";
  }

  // Default: return tool name as-is
  return toolName;
};

/**
 * Get icon for tool type
 */
const getToolIcon = (toolName: string): React.ReactNode => {
  const iconClass = "size-4";
  
  switch (toolName) {
    case "readFile":
      return <FileTextIcon className={iconClass} />;
    case "bashExecute":
      return <TerminalIcon className={iconClass} />;
    case "codebaseSearch":
      return <SearchIcon className={iconClass} />;
    case "searchKnowledge":
      return <BookOpenIcon className={iconClass} />;
    case "writeTestFile":
      return <FileCheckIcon className={iconClass} />;
    case "writeKnowledgeFile":
      return <FileTextIcon className={iconClass} />;
    case "proposeTest":
      return <FileCheckIcon className={iconClass} />;
    case "webSearch":
      return <GlobeIcon className={iconClass} />;
    case "replaceInFile":
      return <FileTextIcon className={iconClass} />;
    default:
      return <CodeIcon className={iconClass} />;
  }
};

const getStatusBadge = (state: ToolState): React.ReactNode | null => {
  const icons: Record<ToolState, React.ReactNode> = {
    "input-streaming": <CircleIcon className="size-3" />,
    "input-available": <ClockIcon className="size-3 animate-pulse" />,
    "approval-requested": null, // No badge - buttons shown inline instead
    "output-available": <CheckCircleIcon className="size-3 text-green-600" />,
    "output-error": <XCircleIcon className="size-3 text-red-600" />,
    "output-denied": (
      <div className="flex items-center gap-1 rounded-full bg-red-100 dark:bg-red-900/30 px-2 py-0.5">
        <XCircleIcon className="size-3 text-red-600 dark:text-red-400" />
        <span className="text-xs font-medium text-red-700 dark:text-red-300">Rejected</span>
      </div>
    ),
  };

  // Show badge for completed, error, and denial states
  if (
    state === "output-available" ||
    state === "output-error" ||
    state === "output-denied"
  ) {
    return (
      <div className="flex items-center">
        {icons[state]}
      </div>
    );
  }

  // Return null for running states and approval-requested (no badge)
  return null;
};

/**
 * Detect if a tool is a file-writing tool
 */
const isFileWritingTool = (toolName: string): boolean => {
  return ["writeTestFile", "writeKnowledgeFile"].includes(toolName);
};

/**
 * Detect language from file extension
 */
const detectLanguageFromPath = (filePath: string): BundledLanguage => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "text";
  const languageMap: Record<string, BundledLanguage> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    html: "html",
    css: "css",
    yml: "yaml",
    yaml: "yaml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    xml: "xml",
    toml: "toml",
    ini: "ini",
  };
  // Use a valid BundledLanguage - default to typescript if unknown
  const lang = languageMap[ext];
  return (lang || "typescript") as BundledLanguage;
};

/**
 * Extract file info (path and content) for file-writing tools
 */
const extractFileInfo = (
  toolName: string,
  input?: unknown,
  output?: unknown,
  streamingContent?: string,
): { filePath: string; content: string; language: BundledLanguage } | null => {
  if (!isFileWritingTool(toolName)) {
    return null;
  }

  // Prefer streaming content if available (for real-time preview)
  if (streamingContent) {
    let filePath: string | undefined;

    if (toolName === "writeTestFile") {
      if (output && typeof output === "object") {
        const out = output as WriteTestFileOutput;
        filePath = out.filePath || out.path;
      }
      if (!filePath && input && typeof input === "object" && isWriteTestFileArgs(input)) {
        filePath = input.targetPath || input.filePath;
      }
    } else if (toolName === "writeKnowledgeFile") {
      if (output && typeof output === "object") {
        const out = output as WriteKnowledgeFileOutput;
        filePath = out.path || out.relativePath;
      }
      if (!filePath && input && typeof input === "object" && isWriteKnowledgeFileArgs(input)) {
        filePath = input.filePath;
      }
    }

    if (filePath) {
      return {
        filePath,
        content: streamingContent,
        language: detectLanguageFromPath(filePath),
      };
    }
  }

  // Fallback to output/input content
  if (output && typeof output === "object") {
    let filePath: string | undefined;
    let content: string | undefined;

    if (toolName === "writeTestFile") {
      const out = output as WriteTestFileOutput;
      filePath = out.filePath || out.path;

      // Content is in input for writeTestFile
      if (input && typeof input === "object" && isWriteTestFileArgs(input)) {
        content = input.testContent;
      }
    } else if (toolName === "writeKnowledgeFile") {
      const out = output as WriteKnowledgeFileOutput;
      filePath = out.path || out.relativePath;

      // Content is in input for writeKnowledgeFile
      if (
        input &&
        typeof input === "object" &&
        isWriteKnowledgeFileArgs(input)
      ) {
        content = input.content;
      }
    }

    if (filePath && content) {
      return {
        filePath,
        content,
        language: detectLanguageFromPath(filePath),
      };
    }
  }

  return null;
};

/**
 * Extract file paths from tool input/output for clickable links
 */
const extractFilePaths = (
  _toolName: string,
  input?: unknown,
  output?: unknown,
): string[] => {
  const paths: string[] = [];

  // Extract from input
  if (input && typeof input === "object") {
    if (isProposeTestArgs(input) && input.sourceFile) {
      paths.push(input.sourceFile);
    }
    if (isWriteTestFileArgs(input)) {
      const path = input.filePath || input.targetTestPath || input.targetPath;
      if (path) paths.push(path);
    }
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) paths.push(path);
    }
    if (isWriteKnowledgeFileArgs(input) && input.filePath) {
      paths.push(input.filePath);
    }
    if (isReplaceInFileArgs(input)) {
      const path = input.targetPath || input.filePath;
      if (path) paths.push(path);
    }
  }

  // Extract from output (for tools like read_file and write tools)
  if (output && typeof output === "object") {
    const outputObj = output as Record<string, unknown>;
    if (outputObj.filePath && typeof outputObj.filePath === "string") {
      paths.push(outputObj.filePath);
    }
    if (outputObj.path && typeof outputObj.path === "string") {
      paths.push(outputObj.path);
    }
    if (outputObj.relativePath && typeof outputObj.relativePath === "string") {
      paths.push(outputObj.relativePath);
    }
  }

  return [...new Set(paths)]; // Remove duplicates
};

/**
 * Generate action list items for tool output
 * Returns an array of action descriptions to display
 */
const generateActionList = (
  toolName: string,
  input?: unknown,
  output?: unknown,
): string[] => {
  const actions: string[] = [];

  // bashExecute: Show command as action (unless it's a file-reading command)
  if (toolName === "bashExecute" && isBashExecuteArgs(input)) {
    const command = input.command.trim();
    // Skip file-reading commands - they're shown in CodeBlock instead
    if (isFileReadingCommand(command)) {
      return [];
    }
    actions.push(command);
    return actions;
  }

  // read_file: Show file read action
  if (toolName === "read_file") {
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) {
        const filename = extractFilename(path);
        if (output && typeof output === "object") {
          const fileOutput = output as { startLine?: number; endLine?: number };
          if (fileOutput.startLine && fileOutput.endLine) {
            actions.push(`Read ${filename} L${fileOutput.startLine}-${fileOutput.endLine}`);
          } else {
            actions.push(`Read ${filename}`);
          }
        } else {
          actions.push(`Read ${filename}`);
        }
      }
    }
    return actions;
  }

  // searchKnowledge: Show search results
  if (toolName === "searchKnowledge" && output && typeof output === "object") {
    const searchOutput = output as {
      results?: Array<{ title?: string; path?: string }>;
      count?: number;
    };
    if (searchOutput.results && searchOutput.results.length > 0) {
      searchOutput.results.forEach((result) => {
        if (result.title) {
          actions.push(`Found: ${result.title}`);
        } else if (result.path) {
          actions.push(`Found: ${extractFilename(result.path)}`);
        }
      });
    }
    return actions;
  }

  // writeTestFile: Show file written
  if (toolName === "writeTestFile") {
    if (output && typeof output === "object") {
      const writeOutput = output as WriteTestFileOutput;
      const path = writeOutput.filePath || writeOutput.path;
      if (path) {
        actions.push(`Wrote ${extractFilename(path)}`);
      }
    }
    return actions;
  }

  // writeKnowledgeFile: Show file written
  if (toolName === "writeKnowledgeFile") {
    if (output && typeof output === "object") {
      const writeOutput = output as WriteKnowledgeFileOutput;
      const path = writeOutput.path || writeOutput.relativePath;
      if (path) {
        actions.push(`Wrote ${extractFilename(path)}`);
      }
    }
    return actions;
  }

  return actions;
};

/**
 * Format output based on tool type for display in body
 */
const formatToolOutput = (
  toolName: string,
  output: unknown,
  errorText?: string,
): React.ReactNode => {
  if (errorText) {
    return (
      <div className="rounded-md bg-destructive/10 p-3 text-destructive text-sm">
        {errorText}
      </div>
    );
  }

  if (!output) {
    return null;
  }

  // Handle bashExecute output - return file matches for grep/find, null for others (handled separately)
  if (toolName === "bashExecute" && typeof output === "object") {
    const bashOutput = output as { stdout?: string; stderr?: string; command?: string };
    const command = bashOutput.command || "";
    
    // Handle file-reading commands (cat, head, tail, less) with proper syntax highlighting
    if (isFileReadingCommand(command) && bashOutput.stdout) {
      const filePath = extractFilePathFromReadCommand(command);
      const language = filePath ? detectLanguageFromPath(filePath) : ("text" as BundledLanguage);
      return (
        <CodeBlock 
          code={bashOutput.stdout} 
          language={language} 
          showLineNumbers={true} 
        >
          <CodeBlockCopyButton />
        </CodeBlock>
      );
    }
    
    // For grep/find commands, return null - we'll handle them in the component body
    if (command.includes("grep") || command.includes("find")) {
      return null;
    }
    
    // For other commands, show stdout/stderr
    if (bashOutput.stdout || bashOutput.stderr) {
      return (
        <div className="space-y-2">
          {bashOutput.stdout && (
            <div>
              <CodeBlock code={bashOutput.stdout} language="bash" />
            </div>
          )}
          {bashOutput.stderr && (
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-1">
                stderr
              </div>
              <CodeBlock code={bashOutput.stderr} language="bash" />
            </div>
          )}
        </div>
      );
    }
  }

  // Handle read_file output - show file content
  if (toolName === "read_file" && typeof output === "object") {
    const fileOutput = output as { content?: string; filePath?: string };
    if (fileOutput.content) {
      const filePath = fileOutput.filePath || "";
      const ext = filePath.split(".").pop()?.toLowerCase() || "text";
      const languageMap: Record<string, string> = {
        ts: "typescript",
        tsx: "tsx",
        js: "javascript",
        jsx: "jsx",
        json: "json",
        md: "markdown",
        py: "python",
        go: "go",
        rs: "rust",
        java: "java",
        cpp: "cpp",
        c: "c",
        html: "html",
        css: "css",
      };
      const language = (languageMap[ext] || "typescript") as BundledLanguage;
      return <CodeBlock code={fileOutput.content} language={language} />;
    }
  }

  // Handle searchKnowledge output - show results list
  if (toolName === "searchKnowledge" && typeof output === "object") {
    const searchOutput = output as {
      results?: Array<{ title?: string; path?: string; content?: string }>;
    };
    if (searchOutput.results && searchOutput.results.length > 0) {
      return (
        <div className="space-y-2">
          {searchOutput.results.map((result) => {
            const key = result.path || result.title || `result-${Math.random()}`;
            return (
              <div key={key} className="text-sm">
                {result.title && (
                  <div className="font-medium">{result.title}</div>
                )}
                {result.path && (
                  <div className="text-muted-foreground text-xs">
                    {result.path}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }

  // For other tools, don't show raw JSON - just return null
  // Action list will be shown instead
  return null;
};

/**
 * Parse grep output to extract file matches with counts
 * Grep output format: "file.tsx:10: match line" or "file.tsx:10:match line"
 */
interface FileMatch {
  filePath: string;
  count: number;
}

const parseGrepOutput = (stdout: string): FileMatch[] => {
  const fileMatches = new Map<string, number>();
  
  // Match lines like "file.tsx:10: match" or "file.tsx:10:match"
  const lines = stdout.split("\n").filter((line) => line.trim());
  
  for (const line of lines) {
    // Match file path before first colon
    const match = line.match(/^([^:]+):/);
    if (match) {
      const filePath = match[1].trim();
      fileMatches.set(filePath, (fileMatches.get(filePath) || 0) + 1);
    }
  }
  
  return Array.from(fileMatches.entries()).map(([filePath, count]) => ({
    filePath,
    count,
  }));
};

/**
 * Parse find output to extract file paths
 */
const parseFindOutput = (stdout: string): string[] => {
  return stdout
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("find:"))
    .map((line) => line.trim());
};

/**
 * Check if command is a file-reading command (cat, head, tail, less)
 */
const isFileReadingCommand = (command: string): boolean => {
  const readCommands = ["cat ", "head ", "tail ", "less "];
  return readCommands.some((cmd) => command.trim().startsWith(cmd));
};

/**
 * Extract file path from file-reading command
 */
const extractFilePathFromReadCommand = (command: string): string | null => {
  // Match: cat/head/tail/less [flags] <filepath>
  const match = command.match(/^(?:cat|head|tail|less)\s+(?:-[^\s]+\s+)*([^\s|><]+)/);
  return match?.[1]?.replace(/['"]/g, "") || null;
};

/**
 * Get VSCode icon name for file type using Iconify's vscode-icons set
 * This matches exactly what users see in VS Code file explorer
 */
const getFileIcon = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const filename = extractFilename(filePath).toLowerCase();
  
  // Special filenames first
  if (filename === "package.json") return "vscode-icons:file-type-node";
  if (filename === "tsconfig.json") return "vscode-icons:file-type-tsconfig";
  if (filename === ".gitignore") return "vscode-icons:file-type-git";
  if (filename === "dockerfile") return "vscode-icons:file-type-docker";
  if (filename.startsWith("readme")) return "vscode-icons:file-type-readme";
  
  // Map extensions to vscode-icons
  const iconMap: Record<string, string> = {
    // TypeScript/JavaScript
    ts: "vscode-icons:file-type-typescript-official",
    tsx: "vscode-icons:file-type-reactts",
    js: "vscode-icons:file-type-js-official",
    jsx: "vscode-icons:file-type-reactjs",
    mjs: "vscode-icons:file-type-js-official",
    cjs: "vscode-icons:file-type-js-official",
    
    // Web
    html: "vscode-icons:file-type-html",
    css: "vscode-icons:file-type-css",
    scss: "vscode-icons:file-type-scss",
    sass: "vscode-icons:file-type-sass",
    less: "vscode-icons:file-type-less",
    
    // Data/Config
    json: "vscode-icons:file-type-json",
    yaml: "vscode-icons:file-type-light-yaml",
    yml: "vscode-icons:file-type-light-yaml",
    toml: "vscode-icons:file-type-toml",
    xml: "vscode-icons:file-type-xml",
    
    // Documentation
    md: "vscode-icons:file-type-markdown",
    mdx: "vscode-icons:file-type-mdx",
    txt: "vscode-icons:file-type-text",
    
    // Programming Languages
    py: "vscode-icons:file-type-python",
    rb: "vscode-icons:file-type-ruby",
    php: "vscode-icons:file-type-php",
    java: "vscode-icons:file-type-java",
    go: "vscode-icons:file-type-go",
    rs: "vscode-icons:file-type-rust",
    c: "vscode-icons:file-type-c",
    cpp: "vscode-icons:file-type-cpp",
    cs: "vscode-icons:file-type-csharp",
    swift: "vscode-icons:file-type-swift",
    kt: "vscode-icons:file-type-kotlin",
    
    // Shell
    sh: "vscode-icons:file-type-shell",
    bash: "vscode-icons:file-type-shell",
    zsh: "vscode-icons:file-type-shell",
    
    // Images
    png: "vscode-icons:file-type-image",
    jpg: "vscode-icons:file-type-image",
    jpeg: "vscode-icons:file-type-image",
    gif: "vscode-icons:file-type-image",
    svg: "vscode-icons:file-type-svg",
    webp: "vscode-icons:file-type-image",
    ico: "vscode-icons:file-type-image",
  };
  
  
  return iconMap[ext] || "vscode-icons:default-file";
};

/**
 * Truncate path for display (show last N segments)
 */
const truncatePath = (path: string, maxSegments: number = 2): string => {
  const parts = path.split(/[/\\]/);
  if (parts.length <= maxSegments) {
    return path;
  }
  return `.../${parts.slice(-maxSegments).join("/")}`;
};


/**
 * FileLink component for clickable file paths
 */
const _FileLink: React.FC<{ filePath: string }> = ({ filePath }) => {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const vscode = getVSCodeAPI();
    vscode.postMessage({
      command: "open-file",
      filePath,
    });
  };

  const filename = extractFilename(filePath);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-primary hover:underline font-medium text-sm"
      title={`Open ${filePath}`}
    >
      {filename}
    </button>
  );
};


export const ToolCallCard: React.FC<ToolCallCardProps> = ({
  toolName,
  state,
  input,
  output,
  errorText,
  streamingContent,
  toolCallId,
  subscriptionId,
}) => {
  const summary = generateToolSummary(toolName, input, output);
  const hasError = state === "output-error" || !!errorText;
  const filePaths = extractFilePaths(toolName, input, output);

  // RPC mutation for approval
  const rpc = useRpc();
  const approveToolCall = rpc.agents.approveToolCall.useMutation();

  // Handler for approval
  const handleApprove = useCallback(() => {
    if (!toolCallId || !subscriptionId) return;
    
    approveToolCall.mutate({
      subscriptionId,
      toolCallId,
      approved: true,
    });
  }, [toolCallId, subscriptionId, approveToolCall]);

  // Handler for rejection
  const handleReject = useCallback(() => {
    if (!toolCallId || !subscriptionId) return;
    
    approveToolCall.mutate({
      subscriptionId,
      toolCallId,
      approved: false,
    });
  }, [toolCallId, subscriptionId, approveToolCall]);

  // Check if this is a file-writing tool with code content
  // Use streaming content if available, otherwise fall back to output/input
  const fileInfo = extractFileInfo(toolName, input, output, streamingContent);
  const isStreaming = !!streamingContent && state !== "output-available";
  const isCodeWritingTool =
    isFileWritingTool(toolName) &&
    fileInfo &&
    (state === "output-available" || isStreaming) &&
    !errorText;

  // Handler to open file
  const handleOpenFile = useCallback((filePath: string) => {
    const vscode = getVSCodeAPI();
    vscode.postMessage({
      command: "open-file",
      filePath,
    });
  }, []);

  // Check if this tool has grouped results (grep/find with file matches)
  const command = isBashExecuteArgs(input)
    ? input.command
    : output && typeof output === "object"
      ? (output as { command?: string }).command
      : "";
  const hasGroupedResults = Boolean(
    toolName === "bashExecute" &&
    command &&
    (command.includes("grep") || command.includes("find")) &&
    output &&
    typeof output === "object" &&
    (output as { stdout?: string }).stdout
  );

  // Render grep/find file lists
  const renderGrepFindResults = useCallback((): React.ReactNode => {
    if (toolName === "bashExecute" && typeof output === "object") {
      const bashOutput = output as { stdout?: string; command?: string };
      const cmd = isBashExecuteArgs(input)
        ? input.command
        : bashOutput.command || "";
      
      // Grep results
      if (cmd.includes("grep") && bashOutput.stdout) {
        const fileMatches = parseGrepOutput(bashOutput.stdout);
        if (fileMatches.length > 0) {
          return (
            <>
              {fileMatches.map((match: FileMatch) => {
                const filename = extractFilename(match.filePath);
                const truncatedPath = truncatePath(match.filePath);
                return (
                  <TaskItem key={match.filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(match.filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon icon={getFileIcon(match.filePath)} className="text-base shrink-0" />
                        <span className="truncate">{filename}</span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {truncatedPath}
                        </span>
                        <span className="ml-auto text-xs font-medium">
                          {match.count}
                        </span>
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                );
              })}
            </>
          );
        }
      }
      
      // Find results
      if (cmd.includes("find") && bashOutput.stdout) {
        const files = parseFindOutput(bashOutput.stdout);
        if (files.length > 0) {
          return (
            <>
              {files.slice(0, 50).map((filePath: string) => {
                const filename = extractFilename(filePath);
                const truncatedPath = truncatePath(filePath);
                return (
                  <TaskItem key={filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon icon={getFileIcon(filePath)} className="text-base shrink-0" />
                        <span className="truncate">{filename}</span>
                        <span className="text-muted-foreground text-xs ml-2">
                          {truncatedPath}
                        </span>
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                );
              })}
              {files.length > 50 && (
                <TaskItem>
                  <span className="text-xs text-muted-foreground">
                    ... and {files.length - 50} more files
                  </span>
                </TaskItem>
              )}
            </>
          );
        }
      }
    }
    return null;
  }, [toolName, input, output, handleOpenFile]);

  // Render action list
  const renderActionList = useCallback((): React.ReactNode => {
    const actions = generateActionList(toolName, input, output);
    if (actions.length > 0) {
      return (
        <>
          {actions.map((action) => (
            <TaskItem key={action}>
              {action}
            </TaskItem>
          ))}
        </>
      );
    }
    return null;
  }, [toolName, input, output]);

  // Render formatted output
  const renderFormattedOutput = useCallback((): React.ReactNode => {
    const formattedOutput = formatToolOutput(toolName, output, errorText);
    if (formattedOutput) {
      return (
        <div className="mt-2">
          {formattedOutput}
        </div>
      );
    }
    return null;
  }, [toolName, output, errorText]);

  // Determine title for TaskTrigger
  const triggerTitle = isCodeWritingTool && fileInfo
    ? extractFilename(fileInfo.filePath)
    : summary;

  const statusBadge = getStatusBadge(state);

  const toolIcon = getToolIcon(toolName);

  return (
    <Task defaultOpen={hasGroupedResults} className={cn(hasError && "opacity-75")}>
      <TaskTrigger title={triggerTitle}>
        <div className="group flex w-full cursor-pointer items-center gap-2 text-muted-foreground text-sm transition-colors hover:text-foreground">
          {toolIcon}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {isCodeWritingTool && fileInfo ? (
              <>
                <Icon icon={getFileIcon(fileInfo.filePath)} className="text-base shrink-0" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenFile(fileInfo.filePath);
                  }}
                  className="font-medium text-sm hover:underline text-left"
                  title={`Open ${fileInfo.filePath}`}
                >
                  {extractFilename(fileInfo.filePath)}
                </button>
              </>
            ) : (
              <span className="text-sm">{summary}</span>
            )}
          </div>
          {/* Inline Approval Buttons for approval-requested state */}
          {/* File edit tools (writeTestFile, replaceInFile) use CodeLens in editor instead */}
          {state === "approval-requested" && toolCallId && subscriptionId && 
           !["writeTestFile", "replaceInFile"].includes(toolName) && (
            <div className="flex items-center gap-1">
              <Button onClick={handleApprove} variant="default" size="sm" className="h-6 px-2 text-xs">
                Approve
              </Button>
              <Button onClick={handleReject} variant="destructive" size="sm" className="h-6 px-2 text-xs">
                Reject
              </Button>
            </div>
          )}
          {statusBadge && (
            <div className="flex items-center gap-2 shrink-0">
              {statusBadge}
            </div>
          )}
          <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180 shrink-0" />
        </div>
      </TaskTrigger>
      <TaskContent>
        {/* Code Writing Tools - Show code prominently */}
        {isCodeWritingTool && fileInfo ? (
          <div className="mt-2">
            {isStreaming && (
              <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <span>Streaming file content...</span>
              </div>
            )}
            <CodeBlock
              code={fileInfo.content}
              language={fileInfo.language}
              showLineNumbers={true}
            >
              <CodeBlockCopyButton />
            </CodeBlock>
          </div>
        ) : (
          <>
            {/* Grep/Find File Lists - Show grouped file results */}
            {renderGrepFindResults()}

            {/* Action List - Clean list of actions taken */}
            {renderActionList()}

            {/* Output/Result - Show formatted output for tools that need it */}
            {renderFormattedOutput()}

            {/* File Links Section - Show clickable file links */}
            {filePaths.length > 0 && (
              filePaths.map((filePath) => (
                  <TaskItem key={filePath}>
                    <div className="flex items-center gap-2 w-full">
                      <TaskItemFile
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenFile(filePath);
                        }}
                        className="cursor-pointer flex-1 items-center gap-2"
                      >
                        <Icon icon={getFileIcon(filePath)} className="text-base shrink-0" />
                        {extractFilename(filePath)}
                      </TaskItemFile>
                    </div>
                  </TaskItem>
                ))
            )}
          </>
        )}
      </TaskContent>
    </Task>
  );
};
