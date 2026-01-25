import { describe, expect, it } from "vitest";
import {
  detectCancellation,
  detectLanguageFromPath,
  extractFilename,
  extractFilePathFromReadCommand,
  generateActionList,
  generateToolSummary,
  getBashCommand,
  getFileIcon,
  getToolDisplayInfo,
  isFileReadingCommand,
  isFileWritingTool,
  parseFindOutput,
  parseGrepOutput,
  truncatePath,
} from "../utils.js";

describe("utils", () => {
  describe("extractFilename", () => {
    it("should extract filename from path", () => {
      expect(extractFilename("/path/to/file.ts")).toBe("file.ts");
      expect(extractFilename("/file.ts")).toBe("file.ts");
      expect(extractFilename("file.ts")).toBe("file.ts");
    });

    it("should handle windows paths", () => {
      expect(extractFilename("C:\\path\\to\\file.ts")).toBe("file.ts");
    });

    it("should handle paths ending in slash", () => {
      // Path ending in slash splits to empty string, which is falsy, so returns original path
      expect(extractFilename("/path/to/")).toBe("/path/to/");
    });
  });

  describe("truncatePath", () => {
    it("should truncate long paths", () => {
      expect(truncatePath("/a/b/c/d/file.ts", 2)).toBe(".../d/file.ts");
    });

    it("should not truncate short paths", () => {
      expect(truncatePath("a/file.ts", 2)).toBe("a/file.ts");
    });

    it("should use default maxSegments", () => {
      expect(truncatePath("/a/b/c/d/e/file.ts")).toBe(".../e/file.ts");
    });
  });

  describe("isFileWritingTool", () => {
    it("should identify file-writing tools", () => {
      expect(isFileWritingTool("writeTestFile")).toBe(true);
      expect(isFileWritingTool("writeKnowledgeFile")).toBe(true);
    });

    it("should return false for non-writing tools", () => {
      expect(isFileWritingTool("read_file")).toBe(false);
      expect(isFileWritingTool("bashExecute")).toBe(false);
    });
  });

  describe("isFileReadingCommand", () => {
    it("should identify file-reading commands", () => {
      expect(isFileReadingCommand("cat file.txt")).toBe(true);
      expect(isFileReadingCommand("head -n 10 file.txt")).toBe(true);
      expect(isFileReadingCommand("tail -f log.txt")).toBe(true);
      expect(isFileReadingCommand("less file.txt")).toBe(true);
    });

    it("should return false for non-reading commands", () => {
      expect(isFileReadingCommand("echo hello")).toBe(false);
      expect(isFileReadingCommand("grep pattern file")).toBe(false);
    });

    it("should handle whitespace", () => {
      expect(isFileReadingCommand("  cat file.txt")).toBe(true);
    });
  });

  describe("extractFilePathFromReadCommand", () => {
    it("should extract file path from cat command", () => {
      expect(extractFilePathFromReadCommand("cat /path/to/file.ts")).toBe(
        "/path/to/file.ts",
      );
    });

    it("should handle simple flags", () => {
      // Regex matches flags without arguments like -n, but not flag values
      // For "head -10 file.ts" it captures file path correctly
      expect(extractFilePathFromReadCommand("tail -f /path/file.ts")).toBe(
        "/path/file.ts",
      );
    });

    it("should remove quotes", () => {
      expect(extractFilePathFromReadCommand("cat '/path/file.ts'")).toBe(
        "/path/file.ts",
      );
    });

    it("should return null for non-read commands", () => {
      expect(extractFilePathFromReadCommand("echo hello")).toBe(null);
    });
  });

  describe("detectLanguageFromPath", () => {
    it("should detect TypeScript", () => {
      expect(detectLanguageFromPath("file.ts")).toBe("typescript");
      expect(detectLanguageFromPath("file.tsx")).toBe("tsx");
    });

    it("should detect JavaScript", () => {
      expect(detectLanguageFromPath("file.js")).toBe("javascript");
      expect(detectLanguageFromPath("file.jsx")).toBe("jsx");
    });

    it("should detect other languages", () => {
      expect(detectLanguageFromPath("file.py")).toBe("python");
      expect(detectLanguageFromPath("file.go")).toBe("go");
      expect(detectLanguageFromPath("file.rs")).toBe("rust");
      expect(detectLanguageFromPath("file.java")).toBe("java");
    });

    it("should detect config files", () => {
      expect(detectLanguageFromPath("file.json")).toBe("json");
      expect(detectLanguageFromPath("file.yml")).toBe("yaml");
      expect(detectLanguageFromPath("file.yaml")).toBe("yaml");
    });

    it("should default to typescript for unknown extensions", () => {
      expect(detectLanguageFromPath("file.unknown")).toBe("typescript");
    });
  });

  describe("getFileIcon", () => {
    it("should return correct icons for TypeScript files", () => {
      expect(getFileIcon("file.ts")).toBe(
        "vscode-icons:file-type-typescript-official",
      );
      expect(getFileIcon("file.tsx")).toBe("vscode-icons:file-type-reactts");
    });

    it("should return correct icons for special filenames", () => {
      expect(getFileIcon("package.json")).toBe("vscode-icons:file-type-node");
      expect(getFileIcon("tsconfig.json")).toBe(
        "vscode-icons:file-type-tsconfig",
      );
      expect(getFileIcon(".gitignore")).toBe("vscode-icons:file-type-git");
    });

    it("should return default icon for unknown extensions", () => {
      expect(getFileIcon("file.unknown")).toBe("vscode-icons:default-file");
    });
  });

  describe("generateToolSummary", () => {
    describe("Bash/bashExecute", () => {
      it("should accept both Bash and bashExecute tool names", () => {
        const input = { command: "echo test" };
        expect(generateToolSummary("bashExecute", input)).toBe("echo test");
        expect(generateToolSummary("Bash", input)).toBe("echo test");
      });

      it("should format cat commands", () => {
        const input = { command: "cat /path/to/file.ts" };
        expect(generateToolSummary("Bash", input)).toBe("cat file.ts");
      });

      it("should format find commands", () => {
        const input = { command: "find /src -name '*.ts'" };
        expect(generateToolSummary("Bash", input)).toBe("find src");
      });

      it("should format grep commands", () => {
        const input = { command: "grep -r 'TODO' /src" };
        expect(generateToolSummary("Bash", input)).toBe("Grepped TODO in src");
      });

      it("should format git commands", () => {
        const input = { command: "git status" };
        expect(generateToolSummary("Bash", input)).toBe("git status");
      });

      it("should truncate long commands", () => {
        const input = { command: "a".repeat(60) };
        const summary = generateToolSummary("Bash", input);
        expect(summary.length).toBeLessThanOrEqual(50);
        expect(summary).toContain("...");
      });
    });

    describe("Read/read_file", () => {
      it("should accept both Read and read_file tool names", () => {
        const input = { filePath: "/path/to/file.ts" };
        expect(generateToolSummary("read_file", input)).toBe("Read file.ts");
        expect(generateToolSummary("Read", input)).toBe("Read file.ts");
      });

      it("should include line range when available", () => {
        const input = { filePath: "/path/to/file.ts" };
        const output = { startLine: 10, endLine: 20 };
        expect(generateToolSummary("Read", input, output)).toBe(
          "Read file.ts L10-20",
        );
      });

      it("should handle targetPath", () => {
        const input = { targetPath: "/path/to/file.ts" };
        expect(generateToolSummary("Read", input)).toBe("Read file.ts");
      });
    });

    describe("searchKnowledge", () => {
      it("should show query", () => {
        const input = { query: "authentication" };
        expect(generateToolSummary("searchKnowledge", input)).toBe(
          'Searching "authentication"',
        );
      });

      it("should show result count", () => {
        const input = { query: "auth" };
        const output = { count: 5 };
        expect(generateToolSummary("searchKnowledge", input, output)).toBe(
          'Found 5 results for "auth"',
        );
      });
    });

    describe("other tools", () => {
      it("should return tool name for unknown tools", () => {
        expect(generateToolSummary("unknownTool")).toBe("unknownTool");
      });
    });
  });

  describe("parseGrepOutput", () => {
    it("should parse grep output into file matches", () => {
      const stdout =
        "/src/file1.ts:10:const x = 1;\n/src/file1.ts:20:const y = 2;\n/src/file2.ts:5:test";
      const matches = parseGrepOutput(stdout);

      expect(matches).toHaveLength(2);
      expect(matches[0]).toEqual({ filePath: "/src/file1.ts", count: 2 });
      expect(matches[1]).toEqual({ filePath: "/src/file2.ts", count: 1 });
    });

    it("should handle empty output", () => {
      expect(parseGrepOutput("")).toHaveLength(0);
      expect(parseGrepOutput("   \n  ")).toHaveLength(0);
    });

    it("should handle lines without colons", () => {
      const stdout = "some random text\n/file.ts:1:match";
      const matches = parseGrepOutput(stdout);
      expect(matches).toHaveLength(1);
    });
  });

  describe("parseFindOutput", () => {
    it("should parse find output into file paths", () => {
      const stdout = "/src/file1.ts\n/src/file2.ts\n/src/file3.ts";
      const files = parseFindOutput(stdout);

      expect(files).toHaveLength(3);
      expect(files[0]).toBe("/src/file1.ts");
    });

    it("should filter out find error lines", () => {
      const stdout = "find: permission denied\n/src/file.ts";
      const files = parseFindOutput(stdout);

      expect(files).toHaveLength(1);
      expect(files[0]).toBe("/src/file.ts");
    });

    it("should handle empty lines", () => {
      const stdout = "/src/file1.ts\n\n/src/file2.ts\n";
      const files = parseFindOutput(stdout);

      expect(files).toHaveLength(2);
    });
  });

  describe("generateActionList", () => {
    describe("Bash/bashExecute", () => {
      it("should accept both tool names", () => {
        const input = { command: "echo test" };
        expect(generateActionList("bashExecute", input)).toContain("echo test");
        expect(generateActionList("Bash", input)).toContain("echo test");
      });

      it("should return empty for file-reading commands", () => {
        const input = { command: "cat file.txt" };
        expect(generateActionList("Bash", input)).toHaveLength(0);
      });
    });

    describe("Read/read_file", () => {
      it("should accept both tool names", () => {
        const input = { filePath: "/path/file.ts" };
        expect(generateActionList("read_file", input)).toContain(
          "Read file.ts",
        );
        expect(generateActionList("Read", input)).toContain("Read file.ts");
      });

      it("should include line range when available", () => {
        const input = { filePath: "/path/file.ts" };
        const output = { startLine: 10, endLine: 20 };
        expect(generateActionList("Read", input, output)).toContain(
          "Read file.ts L10-20",
        );
      });
    });
  });

  describe("detectCancellation", () => {
    it("should detect cancelled in message", () => {
      expect(detectCancellation({ message: "Operation cancelled" })).toBe(true);
      expect(detectCancellation({ error: "Task canceled" })).toBe(true);
    });

    it("should detect cancelled in stderr", () => {
      expect(detectCancellation({}, "Process cancelled")).toBe(true);
    });

    it("should return false for normal output", () => {
      expect(detectCancellation({ message: "Success" })).toBe(false);
      expect(detectCancellation({}, "Normal output")).toBe(false);
    });
  });

  describe("getBashCommand", () => {
    it("should get command from input", () => {
      expect(getBashCommand({ command: "echo test" }, null)).toBe("echo test");
    });

    it("should get command from output", () => {
      expect(getBashCommand(null, { command: "echo test" })).toBe("echo test");
    });

    it("should return empty string when not available", () => {
      expect(getBashCommand(null, null)).toBe("");
      expect(getBashCommand({}, {})).toBe("");
    });
  });

  describe("getToolDisplayInfo", () => {
    describe("Read/read_file tool", () => {
      it("should return label and filename for Read tool", () => {
        const input = { filePath: "/path/to/file.ts" };
        expect(getToolDisplayInfo("Read", input)).toEqual({
          label: "Read file",
          context: "file.ts",
        });
      });

      it("should accept read_file tool name", () => {
        const input = { filePath: "/path/to/file.ts" };
        expect(getToolDisplayInfo("read_file", input)).toEqual({
          label: "Read file",
          context: "file.ts",
        });
      });

      it("should include line range from output", () => {
        const input = { filePath: "/path/to/file.ts" };
        const output = { startLine: 10, endLine: 20 };
        expect(getToolDisplayInfo("Read", input, output)).toEqual({
          label: "Read file",
          context: "file.ts (lines 10-20)",
        });
      });

      it("should include line range from input offset/limit", () => {
        const input = { filePath: "/path/to/file.ts", offset: 5, limit: 10 };
        expect(getToolDisplayInfo("Read", input)).toEqual({
          label: "Read file",
          context: "file.ts (lines 5-15)",
        });
      });

      it("should handle targetPath alternative", () => {
        const input = { targetPath: "/path/to/file.ts" };
        expect(getToolDisplayInfo("Read", input)).toEqual({
          label: "Read file",
          context: "file.ts",
        });
      });

      it("should return label only when no path available", () => {
        expect(getToolDisplayInfo("Read", {})).toEqual({
          label: "Read file",
        });
      });
    });

    describe("Bash/bashExecute tool", () => {
      it("should return first word as label and full command as context", () => {
        const input = { command: "git status" };
        expect(getToolDisplayInfo("Bash", input)).toEqual({
          label: "git",
          context: "git status",
        });
      });

      it("should accept bashExecute tool name", () => {
        const input = { command: "echo test" };
        expect(getToolDisplayInfo("bashExecute", input)).toEqual({
          label: "echo",
          context: "echo test",
        });
      });

      it("should truncate long commands", () => {
        const longCmd = "a".repeat(70);
        const input = { command: longCmd };
        const result = getToolDisplayInfo("Bash", input);
        expect(result.label).toBe("a".repeat(70).split(/\s+/)[0]);
        expect(result.context?.length).toBeLessThanOrEqual(60);
        expect(result.context).toContain("...");
      });

      it("should extract first word for various commands", () => {
        expect(
          getToolDisplayInfo("Bash", { command: "cat file.txt" }).label,
        ).toBe("cat");
        expect(
          getToolDisplayInfo("Bash", { command: "grep pattern" }).label,
        ).toBe("grep");
        expect(getToolDisplayInfo("Bash", { command: "find ." }).label).toBe(
          "find",
        );
      });

      it("should return default label when no command available", () => {
        expect(getToolDisplayInfo("Bash", {})).toEqual({
          label: "Bash",
        });
      });
    });

    describe("Edit/editFileContent tool", () => {
      it("should return Edit label with filename", () => {
        const input = { targetPath: "/path/to/file.ts" };
        expect(getToolDisplayInfo("editFileContent", input)).toEqual({
          label: "Edit",
          context: "file.ts",
        });
      });

      it("should accept Edit tool name", () => {
        const input = { filePath: "/path/to/file.ts" };
        expect(getToolDisplayInfo("Edit", input)).toEqual({
          label: "Edit",
          context: "file.ts",
        });
      });

      it("should return label only when no path available", () => {
        expect(getToolDisplayInfo("editFileContent", {})).toEqual({
          label: "Edit",
        });
      });
    });

    describe("Write/writeTestFile tool", () => {
      it("should return Write label with filename", () => {
        const input = { filePath: "/path/to/test.spec.ts" };
        expect(getToolDisplayInfo("writeTestFile", input)).toEqual({
          label: "Write",
          context: "test.spec.ts",
        });
      });

      it("should accept Write tool name", () => {
        const input = { targetPath: "/path/to/test.spec.ts" };
        expect(getToolDisplayInfo("Write", input)).toEqual({
          label: "Write",
          context: "test.spec.ts",
        });
      });

      it("should handle targetTestPath alternative", () => {
        const input = { targetTestPath: "/path/to/test.spec.ts" };
        expect(getToolDisplayInfo("writeTestFile", input)).toEqual({
          label: "Write",
          context: "test.spec.ts",
        });
      });

      it("should return label only when no path available", () => {
        expect(getToolDisplayInfo("writeTestFile", {})).toEqual({
          label: "Write",
        });
      });
    });

    describe("writeKnowledgeFile tool", () => {
      it("should return Write label with filename", () => {
        const input = { filePath: "/knowledge/auth.md" };
        expect(getToolDisplayInfo("writeKnowledgeFile", input)).toEqual({
          label: "Write",
          context: "auth.md",
        });
      });

      it("should return category as context when no filePath", () => {
        const input = { category: "authentication" };
        expect(getToolDisplayInfo("writeKnowledgeFile", input)).toEqual({
          label: "Write",
          context: "authentication",
        });
      });

      it("should return default label when no path or category", () => {
        expect(getToolDisplayInfo("writeKnowledgeFile", {})).toEqual({
          label: "Write knowledge",
        });
      });
    });

    describe("searchKnowledge tool", () => {
      it("should return Search label with query", () => {
        const input = { query: "authentication" };
        expect(getToolDisplayInfo("searchKnowledge", input)).toEqual({
          label: "Search",
          context: "authentication",
        });
      });

      it("should truncate long queries", () => {
        const longQuery = "a".repeat(50);
        const input = { query: longQuery };
        const result = getToolDisplayInfo("searchKnowledge", input);
        expect(result.label).toBe("Search");
        expect(result.context?.length).toBeLessThanOrEqual(40);
        expect(result.context).toContain("...");
      });

      it("should return default label when no query", () => {
        expect(getToolDisplayInfo("searchKnowledge", {})).toEqual({
          label: "Search knowledge",
        });
      });
    });

    describe("webSearch tool", () => {
      it("should return Web search label with query", () => {
        const input = { query: "react testing" };
        expect(getToolDisplayInfo("webSearch", input)).toEqual({
          label: "Web search",
          context: "react testing",
        });
      });

      it("should truncate long queries", () => {
        const longQuery = "b".repeat(50);
        const input = { query: longQuery };
        const result = getToolDisplayInfo("webSearch", input);
        expect(result.label).toBe("Web search");
        expect(result.context?.length).toBeLessThanOrEqual(40);
        expect(result.context).toContain("...");
      });

      it("should return default label when no query", () => {
        expect(getToolDisplayInfo("webSearch", {})).toEqual({
          label: "Web search",
        });
      });
    });

    describe("proposeTest tool", () => {
      it("should return Propose test label with source filename", () => {
        const input = { sourceFile: "/src/auth/login.ts" };
        expect(getToolDisplayInfo("proposeTest", input)).toEqual({
          label: "Propose test",
          context: "login.ts",
        });
      });

      it("should return default label when no source file", () => {
        expect(getToolDisplayInfo("proposeTest", {})).toEqual({
          label: "Propose test",
        });
      });
    });

    describe("Glob tool", () => {
      it("should return Glob label with pattern", () => {
        const input = { pattern: "**/*.ts" };
        expect(getToolDisplayInfo("Glob", input)).toEqual({
          label: "Glob",
          context: "**/*.ts",
        });
      });

      it("should return default label when no pattern", () => {
        expect(getToolDisplayInfo("Glob", {})).toEqual({
          label: "Glob",
        });
      });
    });

    describe("Grep tool", () => {
      it("should return Grep label with pattern", () => {
        const input = { pattern: "TODO" };
        expect(getToolDisplayInfo("Grep", input)).toEqual({
          label: "Grep",
          context: "TODO",
        });
      });

      it("should include path in context when available", () => {
        const input = { pattern: "TODO", path: "/src/components" };
        expect(getToolDisplayInfo("Grep", input)).toEqual({
          label: "Grep",
          context: "TODO in components",
        });
      });

      it("should return default label when no pattern", () => {
        expect(getToolDisplayInfo("Grep", {})).toEqual({
          label: "Grep",
        });
      });
    });

    describe("Unknown tools", () => {
      it("should return tool name as label for unknown tools", () => {
        expect(getToolDisplayInfo("unknownTool")).toEqual({
          label: "unknownTool",
        });
      });

      it("should handle tool with no input/output", () => {
        expect(getToolDisplayInfo("someTool", undefined, undefined)).toEqual({
          label: "someTool",
        });
      });
    });
  });
});
