import type { BundledLanguage } from "shiki";
import type {
  BashExecuteOutput,
  ExtractedFileInfo,
  FileMatch,
  ReadFileOutput,
  SearchKnowledgeOutput,
  ToolDisplayInfo,
  WriteKnowledgeFileOutput,
  WriteTestFileOutput,
} from "./types.js";
import {
  isBashExecuteArgs,
  isEditFileContentArgs,
  isProposeTestArgs,
  isReadFileArgs,
  isSearchKnowledgeArgs,
  isWebSearchArgs,
  isWriteKnowledgeFileArgs,
  isWriteTestFileArgs,
} from "./types.js";

/**
 * Extracts filename from a full path
 */
export const extractFilename = (path: string): string => {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
};

/**
 * Truncate path for display (show last N segments)
 */
export const truncatePath = (path: string, maxSegments = 2): string => {
  const parts = path.split(/[/\\]/);
  if (parts.length <= maxSegments) {
    return path;
  }
  return `.../${parts.slice(-maxSegments).join("/")}`;
};

/**
 * Detect if a tool is a file-writing tool
 */
export const isFileWritingTool = (toolName: string): boolean => {
  return ["writeTestFile", "writeKnowledgeFile"].includes(toolName);
};

/**
 * Check if command is a file-reading command (cat, head, tail, less)
 */
export const isFileReadingCommand = (command: string): boolean => {
  const readCommands = ["cat ", "head ", "tail ", "less "];
  return readCommands.some((cmd) => command.trim().startsWith(cmd));
};

/**
 * Extract file path from file-reading command
 */
export const extractFilePathFromReadCommand = (
  command: string,
): string | null => {
  const match = command.match(
    /^(?:cat|head|tail|less)\s+(?:-[^\s]+\s+)*([^\s|><]+)/,
  );
  return match?.[1]?.replace(/['"]/g, "") || null;
};

/**
 * Detect language from file extension
 */
export const detectLanguageFromPath = (filePath: string): BundledLanguage => {
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
  const lang = languageMap[ext];
  return (lang || "typescript") as BundledLanguage;
};

/**
 * Get VSCode icon name for file type using Iconify's vscode-icons set
 */
export const getFileIcon = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const filename = extractFilename(filePath).toLowerCase();

  // Special filenames first
  if (filename === "package.json") return "vscode-icons:file-type-node";
  if (filename === "tsconfig.json") return "vscode-icons:file-type-tsconfig";
  if (filename === ".gitignore") return "vscode-icons:file-type-git";
  if (filename === "dockerfile") return "vscode-icons:file-type-docker";
  if (filename.startsWith("readme")) return "vscode-icons:file-type-readme";

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
 * Generate natural language summary for tool header
 */
export const generateToolSummary = (
  toolName: string,
  input?: unknown,
  output?: unknown,
): string => {
  // bashExecute/Bash: Show the command with smart formatting
  if (
    (toolName === "bashExecute" || toolName === "Bash") &&
    isBashExecuteArgs(input)
  ) {
    const command = input.command.trim();
    if (command.startsWith("cat ")) {
      const filePath = command
        .replace(/^cat\s+/, "")
        .split(/\s+/)[0]
        .replace(/['"]/g, "");
      const filename = extractFilename(filePath);
      return `cat ${filename}`;
    }
    if (command.startsWith("find ")) {
      const match = command.match(/find\s+([^\s]+)/);
      if (match) {
        const dir = extractFilename(match[1]);
        return `find ${dir}`;
      }
      return "find files";
    }
    if (command.startsWith("grep ")) {
      const patternMatch = command.match(
        /grep\s+(?:-r\s+)?(?:['"]([^'"]+)['"]|([^\s]+))/,
      );
      const pattern = patternMatch?.[1] || patternMatch?.[2] || "";
      const pathMatch = command.match(
        /grep\s+(?:-r\s+)?(?:['"][^'"]+['"]|[^\s]+)\s+([^\s]+)/,
      );
      const path = pathMatch?.[1] || "";
      if (pattern && path) {
        const dirName = extractFilename(path);
        return `Grepped ${pattern} in ${dirName}`;
      } else if (pattern) {
        return `Grepped ${pattern}`;
      }
      return "grep";
    }
    if (command.startsWith("git ")) {
      const parts = command.split(/\s+/);
      if (parts.length > 1) {
        return `git ${parts[1]}`;
      }
      return "git";
    }
    return command.length > 50 ? `${command.slice(0, 47)}...` : command;
  }

  // read_file/Read: Show "Read <filename>"
  if (toolName === "read_file" || toolName === "Read") {
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) {
        const filename = extractFilename(path);
        if (output && typeof output === "object") {
          const fileOutput = output as ReadFileOutput;
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
      const searchOutput = output as SearchKnowledgeOutput;
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

  // writeTestFile: Show filename
  if (toolName === "writeTestFile") {
    if (isWriteTestFileArgs(input)) {
      const path = input.filePath || input.targetTestPath || input.targetPath;
      if (path) {
        return extractFilename(path);
      }
    }
    return "Writing test file";
  }

  // writeKnowledgeFile: Show filename
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

  // editFileContent: Show "Edit <filename>"
  if (toolName === "editFileContent") {
    if (isEditFileContentArgs(input)) {
      const path = input.targetPath || input.filePath;
      if (path) {
        const filename = extractFilename(path);
        return `Edit ${filename}`;
      }
    }
    return "Edit file";
  }

  return toolName;
};

/**
 * Parse grep output to extract file matches with counts
 */
export const parseGrepOutput = (stdout: string): FileMatch[] => {
  const fileMatches = new Map<string, number>();
  const lines = stdout.split("\n").filter((line) => line.trim());

  for (const line of lines) {
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
export const parseFindOutput = (stdout: string): string[] => {
  return stdout
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("find:"))
    .map((line) => line.trim());
};

/**
 * Extract file info (path and content) for file-writing tools
 */
export const extractFileInfo = (
  toolName: string,
  input?: unknown,
  output?: unknown,
  streamingContent?: string,
): ExtractedFileInfo | null => {
  if (!isFileWritingTool(toolName)) {
    return null;
  }

  if (streamingContent) {
    let filePath: string | undefined;

    if (toolName === "writeTestFile") {
      if (output && typeof output === "object") {
        const out = output as WriteTestFileOutput;
        filePath = out.filePath || out.path;
      }
      if (
        !filePath &&
        input &&
        typeof input === "object" &&
        isWriteTestFileArgs(input)
      ) {
        filePath = input.targetPath || input.filePath;
      }
    } else if (toolName === "writeKnowledgeFile") {
      if (output && typeof output === "object") {
        const out = output as WriteKnowledgeFileOutput;
        filePath = out.path || out.relativePath;
      }
      if (
        !filePath &&
        input &&
        typeof input === "object" &&
        isWriteKnowledgeFileArgs(input)
      ) {
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

  if (output && typeof output === "object") {
    let filePath: string | undefined;
    let content: string | undefined;

    if (toolName === "writeTestFile") {
      const out = output as WriteTestFileOutput;
      filePath = out.filePath || out.path;
      if (input && typeof input === "object" && isWriteTestFileArgs(input)) {
        content = input.testContent;
      }
    } else if (toolName === "writeKnowledgeFile") {
      const out = output as WriteKnowledgeFileOutput;
      filePath = out.path || out.relativePath;
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
export const extractFilePaths = (
  _toolName: string,
  input?: unknown,
  output?: unknown,
): string[] => {
  const paths: string[] = [];

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
    if (isEditFileContentArgs(input)) {
      const path = input.targetPath || input.filePath;
      if (path) paths.push(path);
    }
  }

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

  return [...new Set(paths)];
};

/**
 * Generate action list items for tool output
 */
export const generateActionList = (
  toolName: string,
  input?: unknown,
  output?: unknown,
): string[] => {
  const actions: string[] = [];

  if (
    (toolName === "bashExecute" || toolName === "Bash") &&
    isBashExecuteArgs(input)
  ) {
    const command = input.command.trim();
    if (isFileReadingCommand(command)) {
      return [];
    }
    actions.push(command);
    return actions;
  }

  if (toolName === "read_file" || toolName === "Read") {
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) {
        const filename = extractFilename(path);
        if (output && typeof output === "object") {
          const fileOutput = output as ReadFileOutput;
          if (fileOutput.startLine && fileOutput.endLine) {
            actions.push(
              `Read ${filename} L${fileOutput.startLine}-${fileOutput.endLine}`,
            );
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

  if (toolName === "searchKnowledge" && output && typeof output === "object") {
    const searchOutput = output as SearchKnowledgeOutput;
    if (searchOutput.results && searchOutput.results.length > 0) {
      for (const result of searchOutput.results) {
        if (result.title) {
          actions.push(`Found: ${result.title}`);
        } else if (result.path) {
          actions.push(`Found: ${extractFilename(result.path)}`);
        }
      }
    }
    return actions;
  }

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
 * Check if terminal output indicates cancellation
 */
export const detectCancellation = (
  output: unknown,
  stderr?: string,
): boolean => {
  if (output && typeof output === "object") {
    const outputObj = output as BashExecuteOutput;
    const message = outputObj.message || outputObj.error || "";
    if (
      message.toLowerCase().includes("cancelled") ||
      message.toLowerCase().includes("canceled")
    ) {
      return true;
    }
  }
  if (
    stderr?.toLowerCase().includes("cancelled") ||
    stderr?.toLowerCase().includes("canceled")
  ) {
    return true;
  }
  return false;
};

/**
 * Get command from bash input or output
 */
export const getBashCommand = (input: unknown, output: unknown): string => {
  if (isBashExecuteArgs(input)) {
    return input.command;
  }
  if (output && typeof output === "object") {
    return (output as BashExecuteOutput).command || "";
  }
  return "";
};

/**
 * Get display info for tool header (label + context chip)
 * Used to show tool name and contextual information like filenames or commands
 */
export const getToolDisplayInfo = (
  toolName: string,
  input?: unknown,
  output?: unknown,
): ToolDisplayInfo => {
  // Read tool - show filename with optional line range
  if (toolName === "read_file" || toolName === "Read") {
    if (isReadFileArgs(input)) {
      const path = input.filePath || input.targetPath;
      if (path) {
        const filename = extractFilename(path);
        // Check output for line range info
        if (output && typeof output === "object") {
          const fileOutput = output as ReadFileOutput;
          if (fileOutput.startLine && fileOutput.endLine) {
            return {
              label: "Read file",
              context: `${filename} (lines ${fileOutput.startLine}-${fileOutput.endLine})`,
            };
          }
        }
        // Check input for offset/limit
        const inputObj = input as Record<string, unknown>;
        if (
          typeof inputObj.offset === "number" &&
          typeof inputObj.limit === "number"
        ) {
          const endLine = inputObj.offset + inputObj.limit;
          return {
            label: "Read file",
            context: `${filename} (lines ${inputObj.offset}-${endLine})`,
          };
        }
        return { label: "Read file", context: filename };
      }
    }
    return { label: "Read file" };
  }

  // Bash tool - show command preview
  if (toolName === "bashExecute" || toolName === "Bash") {
    if (isBashExecuteArgs(input)) {
      const cmd = input.command.trim();
      // Extract first word as label (git, cat, grep, find, etc.)
      const firstWord = cmd.split(/\s+/)[0];
      // Truncate long commands
      const truncatedCmd = cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd;
      return { label: firstWord, context: truncatedCmd };
    }
    return { label: "Bash" };
  }

  // Edit tool - show target filename
  if (toolName === "editFileContent" || toolName === "Edit") {
    if (isEditFileContentArgs(input)) {
      const path = input.targetPath || input.filePath;
      if (path) {
        return { label: "Edit", context: extractFilename(path) };
      }
    }
    return { label: "Edit" };
  }

  // Write test file - show target filename
  if (toolName === "writeTestFile" || toolName === "Write") {
    if (isWriteTestFileArgs(input)) {
      const path = input.filePath || input.targetTestPath || input.targetPath;
      if (path) {
        return { label: "Write", context: extractFilename(path) };
      }
    }
    return { label: "Write" };
  }

  // Write knowledge file - show filename or category
  if (toolName === "writeKnowledgeFile") {
    if (isWriteKnowledgeFileArgs(input)) {
      if (input.filePath) {
        return { label: "Write", context: extractFilename(input.filePath) };
      }
      if (input.category) {
        return { label: "Write", context: input.category };
      }
    }
    return { label: "Write knowledge" };
  }

  // Search knowledge - show query
  if (toolName === "searchKnowledge") {
    if (isSearchKnowledgeArgs(input) && input.query) {
      const truncatedQuery =
        input.query.length > 40
          ? `${input.query.slice(0, 37)}...`
          : input.query;
      return { label: "Search", context: truncatedQuery };
    }
    return { label: "Search knowledge" };
  }

  // Web search - show query
  if (toolName === "webSearch") {
    if (isWebSearchArgs(input) && input.query) {
      const truncatedQuery =
        input.query.length > 40
          ? `${input.query.slice(0, 37)}...`
          : input.query;
      return { label: "Web search", context: truncatedQuery };
    }
    return { label: "Web search" };
  }

  // Propose test - show source file
  if (toolName === "proposeTest") {
    if (isProposeTestArgs(input) && input.sourceFile) {
      return {
        label: "Propose test",
        context: extractFilename(input.sourceFile),
      };
    }
    return { label: "Propose test" };
  }

  // Glob tool
  if (toolName === "Glob") {
    const inputObj = input as Record<string, unknown> | undefined;
    if (inputObj?.pattern && typeof inputObj.pattern === "string") {
      return { label: "Glob", context: inputObj.pattern };
    }
    return { label: "Glob" };
  }

  // Grep tool
  if (toolName === "Grep") {
    const inputObj = input as Record<string, unknown> | undefined;
    if (inputObj?.pattern && typeof inputObj.pattern === "string") {
      const pattern = inputObj.pattern;
      const path = inputObj.path as string | undefined;
      if (path) {
        return {
          label: "Grep",
          context: `${pattern} in ${extractFilename(path)}`,
        };
      }
      return { label: "Grep", context: pattern };
    }
    return { label: "Grep" };
  }

  // Default - just return tool name
  return { label: toolName };
};
