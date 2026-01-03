import type React from "react";
import type { BundledLanguage } from "shiki";
import {
  CodeBlock,
  CodeBlockCopyButton,
} from "@clive/ui/components/ai-elements/code-block";
import type {
  BashExecuteOutput,
  ReadFileOutput,
  SearchKnowledgeOutput,
} from "./types.js";
import {
  isFileReadingCommand,
  extractFilePathFromReadCommand,
  detectLanguageFromPath,
} from "./utils.js";

/**
 * Format output based on tool type for display in body
 */
export const formatToolOutput = (
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

  // Handle bashExecute output
  if (toolName === "bashExecute" && typeof output === "object") {
    const bashOutput = output as BashExecuteOutput;
    const command = bashOutput.command || "";

    // Handle file-reading commands with proper syntax highlighting
    if (isFileReadingCommand(command) && bashOutput.stdout) {
      const filePath = extractFilePathFromReadCommand(command);
      const language = filePath ? detectLanguageFromPath(filePath) : ("text" as BundledLanguage);
      return (
        <CodeBlock code={bashOutput.stdout} language={language} showLineNumbers={true}>
          <CodeBlockCopyButton />
        </CodeBlock>
      );
    }

    // For grep/find commands, return null - handled separately
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
              <div className="text-xs font-medium text-muted-foreground mb-1">stderr</div>
              <CodeBlock code={bashOutput.stderr} language="bash" />
            </div>
          )}
        </div>
      );
    }
  }

  // Handle read_file output
  if (toolName === "read_file" && typeof output === "object") {
    const fileOutput = output as ReadFileOutput;
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

  // Handle searchKnowledge output
  if (toolName === "searchKnowledge" && typeof output === "object") {
    const searchOutput = output as SearchKnowledgeOutput;
    if (searchOutput.results && searchOutput.results.length > 0) {
      return (
        <div className="space-y-2">
          {searchOutput.results.map((result) => {
            const key = result.path || result.title || `result-${Math.random()}`;
            return (
              <div key={key} className="text-sm">
                {result.title && <div className="font-medium">{result.title}</div>}
                {result.path && (
                  <div className="text-muted-foreground text-xs">{result.path}</div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
  }

  return null;
};
