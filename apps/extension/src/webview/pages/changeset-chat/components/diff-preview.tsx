import { cn } from "@clive/ui";
import { Icon } from "@iconify/react";
import { ChevronDown, ChevronRight, FileEdit, Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * SEARCH/REPLACE block interface
 */
interface SearchReplaceBlock {
  search: string;
  replace: string;
}

/**
 * Diff line for display
 */
interface DiffLine {
  type: "removed" | "added" | "context";
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/**
 * Parse SEARCH/REPLACE blocks from diff string
 * Supports modern format (------- SEARCH / ======= / +++++++ REPLACE)
 * and legacy format (< SEARCH / >>> REPLACE)
 */
function parseSearchReplaceBlocks(diff: string): SearchReplaceBlock[] {
  const blocks: SearchReplaceBlock[] = [];

  // Try modern format first
  const modernPattern =
    /(-{7,}\s*SEARCH\s*\n)([\s\S]*?)(={7,}\s*\n)([\s\S]*?)(\+{7,}\s*REPLACE\s*\n?)/g;

  modernPattern.lastIndex = 0;

  let match: RegExpExecArray | null = modernPattern.exec(diff);
  while (match !== null) {
    const searchContent = match[2].replace(/\n+$/, "");
    const replaceContent = match[4].replace(/\n+$/, "");

    blocks.push({
      search: searchContent,
      replace: replaceContent,
    });
    match = modernPattern.exec(diff);
  }

  // If no modern format blocks found, try legacy format
  if (blocks.length === 0) {
    const legacyPattern =
      /(?:<{1,3}\s*SEARCH\s*\n)([\s\S]*?)(?:>{3}\s*REPLACE\s*\n)([\s\S]*?)(?=(?:<{1,3}\s*SEARCH|$))/g;
    legacyPattern.lastIndex = 0;

    match = legacyPattern.exec(diff);
    while (match !== null) {
      const searchContent = match[1].replace(/\n+$/, "");
      const replaceContent = match[2].replace(/\n+$/, "");

      blocks.push({
        search: searchContent,
        replace: replaceContent,
      });
      match = legacyPattern.exec(diff);
    }
  }

  return blocks;
}

/**
 * Convert SEARCH/REPLACE blocks to diff lines for display
 */
function blocksToDiffLines(blocks: SearchReplaceBlock[]): DiffLine[] {
  const lines: DiffLine[] = [];

  for (const block of blocks) {
    const searchLines = block.search.split("\n");
    const replaceLines = block.replace.split("\n");

    // Add removed lines (from search block)
    for (const line of searchLines) {
      lines.push({
        type: "removed",
        content: line,
      });
    }

    // Add added lines (from replace block)
    for (const line of replaceLines) {
      lines.push({
        type: "added",
        content: line,
      });
    }
  }

  return lines;
}

/**
 * Calculate change summary from blocks
 */
function calculateChangeSummary(blocks: SearchReplaceBlock[]): {
  added: number;
  removed: number;
  message: string;
} {
  let added = 0;
  let removed = 0;

  for (const block of blocks) {
    const searchLines = block.search.split("\n").filter((l) => l.length > 0);
    const replaceLines = block.replace.split("\n").filter((l) => l.length > 0);
    removed += searchLines.length;
    added += replaceLines.length;
  }

  if (removed === 0 && added > 0) {
    return {
      added,
      removed,
      message: `Added ${added} line${added !== 1 ? "s" : ""}`,
    };
  }
  if (added === 0 && removed > 0) {
    return {
      added,
      removed,
      message: `Removed ${removed} line${removed !== 1 ? "s" : ""}`,
    };
  }
  if (added === removed) {
    return {
      added,
      removed,
      message: `Changed ${added} line${added !== 1 ? "s" : ""}`,
    };
  }

  const net = added - removed;
  if (net > 0) {
    return {
      added,
      removed,
      message: `+${net} line${net !== 1 ? "s" : ""} (${removed} removed, ${added} added)`,
    };
  }
  return {
    added,
    removed,
    message: `${net} line${Math.abs(net) !== 1 ? "s" : ""} (${removed} removed, ${added} added)`,
  };
}

/**
 * Extract filename from a full path
 */
function extractFilename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

/**
 * Get VSCode icon name for file type
 */
function getFileIcon(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const filename = extractFilename(filePath).toLowerCase();

  // Special filenames first
  if (filename === "package.json") return "vscode-icons:file-type-node";
  if (filename === "tsconfig.json") return "vscode-icons:file-type-tsconfig";
  if (filename === ".gitignore") return "vscode-icons:file-type-git";

  // Map extensions to vscode-icons
  const iconMap: Record<string, string> = {
    ts: "vscode-icons:file-type-typescript-official",
    tsx: "vscode-icons:file-type-reactts",
    js: "vscode-icons:file-type-js-official",
    jsx: "vscode-icons:file-type-reactjs",
    json: "vscode-icons:file-type-json",
    md: "vscode-icons:file-type-markdown",
    py: "vscode-icons:file-type-python",
    go: "vscode-icons:file-type-go",
    rs: "vscode-icons:file-type-rust",
    java: "vscode-icons:file-type-java",
    cpp: "vscode-icons:file-type-cpp",
    c: "vscode-icons:file-type-c",
    html: "vscode-icons:file-type-html",
    css: "vscode-icons:file-type-css",
    yaml: "vscode-icons:file-type-light-yaml",
    yml: "vscode-icons:file-type-light-yaml",
  };

  return iconMap[ext] || "vscode-icons:default-file";
}

interface DiffPreviewProps {
  filePath: string;
  diff: string;
  className?: string;
  defaultCollapsed?: boolean;
  onOpenFile?: (filePath: string) => void;
}

export function DiffPreview({
  filePath,
  diff,
  className,
  defaultCollapsed = false,
  onOpenFile,
}: DiffPreviewProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const blocks = useMemo(() => parseSearchReplaceBlocks(diff), [diff]);
  const diffLines = useMemo(() => blocksToDiffLines(blocks), [blocks]);
  const summary = useMemo(() => calculateChangeSummary(blocks), [blocks]);

  const filename = extractFilename(filePath);
  const fileIcon = getFileIcon(filePath);

  // Calculate line numbers for display
  const linesWithNumbers = useMemo(() => {
    let oldLine = 1;
    let newLine = 1;

    return diffLines.map((line) => {
      const result = {
        ...line,
        oldLineNumber: undefined as number | undefined,
        newLineNumber: undefined as number | undefined,
      };

      if (line.type === "removed") {
        result.oldLineNumber = oldLine++;
      } else if (line.type === "added") {
        result.newLineNumber = newLine++;
      } else {
        result.oldLineNumber = oldLine++;
        result.newLineNumber = newLine++;
      }

      return result;
    });
  }, [diffLines]);

  const handleHeaderClick = () => {
    setIsCollapsed(!isCollapsed);
  };

  const handleFilenameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenFile?.(filePath);
  };

  return (
    <div
      className={cn(
        "rounded-md border border-border/50 overflow-hidden bg-card",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50">
        <button
          type="button"
          className="flex-shrink-0 cursor-pointer hover:bg-muted/70 transition-colors rounded p-0.5 -m-0.5"
          onClick={handleHeaderClick}
          aria-expanded={!isCollapsed}
          aria-label={isCollapsed ? "Expand diff" : "Collapse diff"}
        >
          {isCollapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )}
        </button>

        <FileEdit className="size-4 text-muted-foreground flex-shrink-0" />

        <span className="text-sm font-medium text-foreground">Edit</span>

        <Icon icon={fileIcon} className="text-base flex-shrink-0" />

        <button
          type="button"
          onClick={handleFilenameClick}
          className="text-sm font-mono text-foreground hover:underline hover:text-primary transition-colors"
          title={`Open ${filePath}`}
        >
          {filename}
        </button>

        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
          {summary.message}
        </span>
      </div>

      {/* Diff content */}
      {!isCollapsed && (
        <div className="overflow-x-auto">
          <div className="font-mono text-xs leading-relaxed">
            {linesWithNumbers.map((line) => (
              <div
                key={`${line.type}-${line.oldLineNumber ?? "x"}-${line.newLineNumber ?? "x"}`}
                className={cn(
                  "flex items-stretch min-h-[24px]",
                  line.type === "removed" && "bg-red-500/15 dark:bg-red-900/25",
                  line.type === "added" &&
                    "bg-green-500/15 dark:bg-green-900/25",
                )}
              >
                {/* Line number gutter */}
                <div className="flex-shrink-0 w-16 flex">
                  {/* Old line number */}
                  <div
                    className={cn(
                      "w-8 px-1 text-right select-none",
                      line.type === "removed"
                        ? "text-red-600/70 dark:text-red-400/70 bg-red-500/10"
                        : line.type === "added"
                          ? "bg-green-500/5"
                          : "text-muted-foreground/50",
                    )}
                  >
                    {line.oldLineNumber || ""}
                  </div>
                  {/* New line number */}
                  <div
                    className={cn(
                      "w-8 px-1 text-right select-none",
                      line.type === "added"
                        ? "text-green-600/70 dark:text-green-400/70 bg-green-500/10"
                        : line.type === "removed"
                          ? "bg-red-500/5"
                          : "text-muted-foreground/50",
                    )}
                  >
                    {line.newLineNumber || ""}
                  </div>
                </div>

                {/* Sign indicator */}
                <div
                  className={cn(
                    "w-5 flex-shrink-0 flex items-center justify-center",
                    line.type === "removed" && "text-red-600 dark:text-red-400",
                    line.type === "added" &&
                      "text-green-600 dark:text-green-400",
                  )}
                >
                  {line.type === "removed" && <Minus className="size-3" />}
                  {line.type === "added" && <Plus className="size-3" />}
                </div>

                {/* Line content */}
                <pre
                  className={cn(
                    "flex-1 px-2 py-0.5 whitespace-pre overflow-x-auto",
                    line.type === "removed" && "text-red-800 dark:text-red-200",
                    line.type === "added" &&
                      "text-green-800 dark:text-green-200",
                  )}
                >
                  {line.content || " "}
                </pre>
              </div>
            ))}

            {/* Empty state */}
            {linesWithNumbers.length === 0 && (
              <div className="px-4 py-3 text-muted-foreground text-center">
                No changes to display
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export type { DiffPreviewProps };
