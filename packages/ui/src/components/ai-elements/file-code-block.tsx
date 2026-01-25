"use client";

import type { HTMLAttributes } from "react";
import type { BundledLanguage } from "shiki";
import { cn } from "../../lib/utils";
import { CodeBlock } from "./code-block";

/**
 * Map file extension to Shiki language code and display label
 */
const getFileTypeInfo = (
  filePath: string,
): {
  language: BundledLanguage;
  label: string;
} => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";

  const extensionMap: Record<
    string,
    { language: BundledLanguage; label: string }
  > = {
    ts: { language: "typescript", label: "TS" },
    tsx: { language: "tsx", label: "TS" },
    js: { language: "javascript", label: "JS" },
    jsx: { language: "jsx", label: "JS" },
    py: { language: "python", label: "PY" },
    java: { language: "java", label: "JAVA" },
    go: { language: "go", label: "GO" },
    rs: { language: "rust", label: "RS" },
    rb: { language: "ruby", label: "RB" },
    php: { language: "php", label: "PHP" },
    swift: { language: "swift", label: "SWIFT" },
    kt: { language: "kotlin", label: "KT" },
    scala: { language: "scala", label: "SCALA" },
    sh: { language: "bash", label: "SH" },
    bash: { language: "bash", label: "SH" },
    zsh: { language: "bash", label: "SH" },
    yml: { language: "yaml", label: "YML" },
    yaml: { language: "yaml", label: "YML" },
    json: { language: "json", label: "JSON" },
    xml: { language: "xml", label: "XML" },
    html: { language: "html", label: "HTML" },
    css: { language: "css", label: "CSS" },
    scss: { language: "scss", label: "SCSS" },
    sass: { language: "sass", label: "SASS" },
    less: { language: "less", label: "LESS" },
    md: { language: "markdown", label: "MD" },
    markdown: { language: "markdown", label: "MD" },
    sql: { language: "sql", label: "SQL" },
    dockerfile: { language: "dockerfile", label: "DOCKER" },
    toml: { language: "toml", label: "TOML" },
    ini: { language: "ini", label: "INI" },
    diff: { language: "diff", label: "DIFF" },
    patch: { language: "diff", label: "PATCH" },
  };

  return (
    extensionMap[ext] || {
      language: "text" as BundledLanguage,
      label: ext.toUpperCase() || "FILE",
    }
  );
};

export type FileCodeBlockProps = HTMLAttributes<HTMLDivElement> & {
  code: string;
  filePath: string;
  badge?: string | number;
  showLineNumbers?: boolean;
};

/**
 * CodeBlock component with file header showing file type indicator, filename, and optional badge
 * Matches VS Code file tab style with rounded top corners
 */
export const FileCodeBlock = ({
  code,
  filePath,
  badge,
  showLineNumbers = false,
  className,
  ...props
}: FileCodeBlockProps) => {
  const fileName = filePath.split("/").pop() || filePath;
  const { language, label } = getFileTypeInfo(filePath);

  return (
    <div
      className={cn("w-full overflow-hidden rounded-t-md", className)}
      {...props}
    >
      {/* File Header */}
      <div className="flex items-center gap-2 rounded-t-md bg-muted px-2 py-1.5 border-b border-border">
        {/* File Type Badge */}
        <div className="flex items-center justify-center rounded bg-blue-500 px-1.5 py-0.5 min-w-[2rem]">
          <span className="text-xs font-medium text-white">{label}</span>
        </div>

        {/* Filename */}
        <span className="flex-1 text-sm font-medium text-foreground truncate">
          {fileName}
        </span>

        {/* Optional Badge */}
        {badge !== undefined && (
          <div className="flex items-center justify-center rounded bg-destructive px-1.5 py-0.5 min-w-[1.5rem]">
            <span className="text-xs font-medium text-white">
              {String(badge)}
            </span>
          </div>
        )}
      </div>

      {/* Code Block */}
      <CodeBlock
        code={code}
        language={language}
        showLineNumbers={showLineNumbers}
        className="rounded-t-none"
      />
    </div>
  );
};
