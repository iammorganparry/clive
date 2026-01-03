import { describe, expect, it, vi, beforeEach } from "vitest";
import { Runtime } from "effect";

// Use vi.hoisted to create mock functions that can be referenced in vi.mock
const { mockReadFile, mockWriteFile, mockExecAsync, mockGlob } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockExecAsync: vi.fn(),
  mockGlob: vi.fn(),
}));

// Mock the logger
vi.mock("../../../utils/logger.js", () => ({
  logToOutput: vi.fn(),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
}));

// Mock child_process - promisify will be called on exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock util.promisify to return our mock
vi.mock("node:util", () => ({
  promisify: () => mockExecAsync,
}));

// Mock glob
vi.mock("glob", () => ({
  glob: (...args: unknown[]) => mockGlob(...args),
}));

// Import after mocks are set up
import { createCliToolExecutor } from "../cli-tool-executor.js";

describe("cli-tool-executor", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Read tool handler", () => {
    it("should read file contents successfully", async () => {
      mockReadFile.mockResolvedValue("line1\nline2\nline3");

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Read", { file_path: "/test/file.ts" }, "tool-1")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.filePath).toBe("/test/file.ts");
      expect(parsed.content).toContain("line1");
      expect(parsed.startLine).toBe(1);
    });

    it("should return structured JSON with line numbers", async () => {
      mockReadFile.mockResolvedValue("const x = 1;\nconst y = 2;");

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Read", { file_path: "/test/code.ts" }, "tool-2")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      // Should have line numbers like cat -n format
      expect(parsed.content).toMatch(/^\s+1.*const x/);
      expect(parsed.content).toMatch(/\s+2.*const y/);
    });

    it("should apply offset and limit parameters", async () => {
      mockReadFile.mockResolvedValue("line1\nline2\nline3\nline4\nline5");

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Read",
          { file_path: "/test/file.ts", offset: 1, limit: 2 },
          "tool-3",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.startLine).toBe(2); // 1-indexed (offset 1 = start at line 2)
      expect(parsed.endLine).toBe(3);
      // Should contain lines 2 and 3 (0-indexed: 1 and 2)
      expect(parsed.content).toContain("line2");
      expect(parsed.content).toContain("line3");
      expect(parsed.content).not.toContain("line1");
      expect(parsed.content).not.toContain("line4");
    });

    it("should handle file not found errors", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Read", { file_path: "/nonexistent.ts" }, "tool-4")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read file");
    });
  });

  describe("Write tool handler", () => {
    it("should write file contents successfully", async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Write",
          { file_path: "/test/output.ts", content: "const x = 1;" },
          "tool-5",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      expect(result.result).toContain("Successfully wrote");
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/test/output.ts",
        "const x = 1;",
        "utf-8",
      );
    });

    it("should handle write errors", async () => {
      mockWriteFile.mockRejectedValue(new Error("Permission denied"));

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Write",
          { file_path: "/readonly/file.ts", content: "test" },
          "tool-6",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to write file");
    });
  });

  describe("Edit tool handler", () => {
    it("should replace single occurrence", async () => {
      mockReadFile.mockResolvedValue("const x = 1;\nconst x = 2;");
      mockWriteFile.mockResolvedValue(undefined);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Edit",
          {
            file_path: "/test/file.ts",
            old_string: "const x = 1;",
            new_string: "const y = 1;",
          },
          "tool-7",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/test/file.ts",
        "const y = 1;\nconst x = 2;",
        "utf-8",
      );
    });

    it("should replace all occurrences when replace_all is true", async () => {
      mockReadFile.mockResolvedValue("foo bar foo baz foo");
      mockWriteFile.mockResolvedValue(undefined);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Edit",
          {
            file_path: "/test/file.ts",
            old_string: "foo",
            new_string: "qux",
            replace_all: true,
          },
          "tool-8",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      expect(mockWriteFile).toHaveBeenCalledWith(
        "/test/file.ts",
        "qux bar qux baz qux",
        "utf-8",
      );
    });

    it("should return error when string not found", async () => {
      mockReadFile.mockResolvedValue("const x = 1;");

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall(
          "Edit",
          {
            file_path: "/test/file.ts",
            old_string: "nonexistent",
            new_string: "replacement",
          },
          "tool-9",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Could not find string");
    });
  });

  describe("Bash tool handler", () => {
    it("should execute command and return structured JSON", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "hello world\n", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Bash", { command: "echo hello world" }, "tool-10")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.command).toBe("echo hello world");
      expect(parsed.stdout).toBe("hello world\n");
      expect(parsed.stderr).toBe("");
      expect(parsed.exitCode).toBe(0);
    });

    it("should handle command errors with exit code", async () => {
      const execError = new Error("Command failed") as Error & {
        code: number;
        stdout: string;
        stderr: string;
      };
      execError.code = 1;
      execError.stdout = "";
      execError.stderr = "command not found";
      mockExecAsync.mockRejectedValue(execError);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Bash", { command: "invalid-cmd" }, "tool-11")
        .pipe(Runtime.runPromise(runtime));

      // Command with non-zero exit still returns result
      const parsed = JSON.parse(result.result);
      expect(parsed.exitCode).toBe(1);
      expect(parsed.stderr).toContain("command not found");
    });

    it("should respect timeout parameter", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "done", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall(
          "Bash",
          { command: "sleep 1", timeout: 5000 },
          "tool-12",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(mockExecAsync).toHaveBeenCalledWith(
        "sleep 1",
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it("should use default timeout of 2 minutes", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "done", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall("Bash", { command: "echo test" }, "tool-13")
        .pipe(Runtime.runPromise(runtime));

      expect(mockExecAsync).toHaveBeenCalledWith(
        "echo test",
        expect.objectContaining({ timeout: 120000 }),
      );
    });
  });

  describe("Glob tool handler", () => {
    it("should return structured JSON with pattern and files", async () => {
      mockGlob.mockResolvedValue(["/src/file1.ts", "/src/file2.ts"]);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Glob", { pattern: "**/*.ts" }, "tool-14")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.pattern).toBe("**/*.ts");
      expect(parsed.files).toHaveLength(2);
      expect(parsed.files[0].path).toBe("/src/file1.ts");
      expect(parsed.totalMatches).toBe(2);
    });

    it("should match files in specified path", async () => {
      mockGlob.mockResolvedValue([]);

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall("Glob", { pattern: "*.js", path: "/custom/dir" }, "tool-15")
        .pipe(Runtime.runPromise(runtime));

      expect(mockGlob).toHaveBeenCalledWith(
        "*.js",
        expect.objectContaining({ cwd: "/custom/dir" }),
      );
    });

    it("should handle glob errors", async () => {
      mockGlob.mockRejectedValue(new Error("Invalid pattern"));

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Glob", { pattern: "[invalid" }, "tool-16")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Glob failed");
    });
  });

  describe("Grep tool handler", () => {
    it("should return structured JSON with pattern and files", async () => {
      mockExecAsync.mockResolvedValue({
        stdout: "/src/file1.ts\n/src/file2.ts\n",
        stderr: "",
      });

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Grep", { pattern: "TODO" }, "tool-17")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.pattern).toBe("TODO");
      expect(parsed.files).toHaveLength(2);
      expect(parsed.files[0].path).toBe("/src/file1.ts");
      expect(parsed.totalMatches).toBe(2);
    });

    it("should handle glob patterns", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall(
          "Grep",
          { pattern: "test", glob: "*.ts" },
          "tool-18",
        )
        .pipe(Runtime.runPromise(runtime));

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining("--glob"),
        expect.any(Object),
      );
    });

    it("should use 30 second timeout", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall("Grep", { pattern: "test" }, "tool-19")
        .pipe(Runtime.runPromise(runtime));

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ timeout: 30000 }),
      );
    });

    it("should return empty results for no matches (exit code 1)", async () => {
      const noMatchError = new Error("No matches") as Error & { code: number };
      noMatchError.code = 1;
      mockExecAsync.mockRejectedValue(noMatchError);

      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("Grep", { pattern: "nonexistent" }, "tool-20")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.result);
      expect(parsed.files).toHaveLength(0);
      expect(parsed.totalMatches).toBe(0);
    });

    it("should escape shell patterns properly", async () => {
      mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });

      const executor = createCliToolExecutor({ tools: {} });
      await executor
        .executeToolCall("Grep", { pattern: "test'quote" }, "tool-21")
        .pipe(Runtime.runPromise(runtime));

      // Pattern should be escaped for shell
      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining("test'\\''quote"),
        expect.any(Object),
      );
    });
  });

  describe("Custom tool execution", () => {
    it("should return error for unknown tools", async () => {
      const executor = createCliToolExecutor({ tools: {} });
      const result = await executor
        .executeToolCall("UnknownTool", {}, "tool-22")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown tool");
    });

    it("should fall back to custom tools when not a builtin", async () => {
      const customTool = {
        execute: vi.fn().mockResolvedValue({ message: "custom result" }),
      };
      const executor = createCliToolExecutor({
        tools: { customTool } as unknown as Parameters<
          typeof createCliToolExecutor
        >[0]["tools"],
      });

      const result = await executor
        .executeToolCall("customTool", { arg: "value" }, "tool-23")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(true);
      expect(customTool.execute).toHaveBeenCalledWith(
        { arg: "value" },
        expect.objectContaining({ toolCallId: "tool-23" }),
      );
    });

    it("should return error for tools without execute function", async () => {
      const toolWithoutExecute = { description: "no execute" };
      const executor = createCliToolExecutor({
        tools: { toolWithoutExecute } as unknown as Parameters<
          typeof createCliToolExecutor
        >[0]["tools"],
      });

      const result = await executor
        .executeToolCall("toolWithoutExecute", {}, "tool-24")
        .pipe(Runtime.runPromise(runtime));

      expect(result.success).toBe(false);
      expect(result.error).toContain("does not have an execute function");
    });
  });

  describe("Progress callbacks", () => {
    it("should emit tool-executing event", async () => {
      mockReadFile.mockResolvedValue("content");
      const progressCallback = vi.fn();

      const executor = createCliToolExecutor({ tools: {}, progressCallback });
      await executor
        .executeToolCall("Read", { file_path: "/test.ts" }, "tool-25")
        .pipe(Runtime.runPromise(runtime));

      expect(progressCallback).toHaveBeenCalledWith(
        "tool-executing",
        expect.stringContaining("tool-25"),
      );
    });

    it("should emit tool-completed event", async () => {
      mockReadFile.mockResolvedValue("content");
      const progressCallback = vi.fn();

      const executor = createCliToolExecutor({ tools: {}, progressCallback });
      await executor
        .executeToolCall("Read", { file_path: "/test.ts" }, "tool-26")
        .pipe(Runtime.runPromise(runtime));

      expect(progressCallback).toHaveBeenCalledWith(
        "tool-completed",
        expect.stringContaining("tool-26"),
      );
    });
  });
});
