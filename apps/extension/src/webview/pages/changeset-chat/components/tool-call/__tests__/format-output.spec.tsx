/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { formatToolOutput } from "../format-output.js";

// Cleanup after each test to avoid DOM accumulation
afterEach(() => {
  cleanup();
});

// Mock CodeBlock component to simplify testing
vi.mock("@clive/ui/components/ai-elements/code-block", () => ({
  CodeBlock: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid="code-block" data-language={language}>
      {code}
    </pre>
  ),
  CodeBlockCopyButton: () => <button type="button" data-testid="copy-button">Copy</button>,
}));

describe("formatToolOutput", () => {
  describe("Error display", () => {
    it("should render error message in destructive style", () => {
      const result = formatToolOutput("Bash", {}, "Something went wrong");

      // Render the result to check it
      const { container } = render(<div>{result}</div>);
      expect(container.textContent).toContain("Something went wrong");
      expect(container.querySelector(".bg-destructive\\/10")).toBeTruthy();
    });

    it("should return null when no output and no error", () => {
      const result = formatToolOutput("Bash", null);
      expect(result).toBeNull();
    });
  });

  describe("Bash/bashExecute output", () => {
    it("should accept both Bash and bashExecute tool names", () => {
      const output = {
        command: "echo test",
        stdout: "test output",
        stderr: "",
        exitCode: 0,
      };

      // Both should produce output
      const bashResult = formatToolOutput("Bash", output);
      const bashExecuteResult = formatToolOutput("bashExecute", output);

      expect(bashResult).not.toBeNull();
      expect(bashExecuteResult).not.toBeNull();
    });

    it("should render file-reading commands with syntax highlighting", () => {
      const output = {
        command: "cat /path/to/file.ts",
        stdout: "const x = 1;",
        stderr: "",
        exitCode: 0,
      };

      const result = formatToolOutput("Bash", output);
      const { container } = render(<div>{result}</div>);

      // Should render with CodeBlock
      expect(screen.getByTestId("code-block")).toBeTruthy();
      expect(container.textContent).toContain("const x = 1;");
    });

    it("should render stdout with CodeBlock", () => {
      const output = {
        command: "echo test",
        stdout: "test output line",
        stderr: "",
        exitCode: 0,
      };

      const result = formatToolOutput("Bash", output);
      const { container } = render(<div>{result}</div>);

      expect(container.textContent).toContain("test output line");
    });

    it("should render stderr with label", () => {
      const output = {
        command: "invalid-cmd",
        stdout: "",
        stderr: "command not found",
        exitCode: 1,
      };

      const result = formatToolOutput("Bash", output);
      const { container } = render(<div>{result}</div>);

      expect(container.textContent).toContain("stderr");
      expect(container.textContent).toContain("command not found");
    });

    it("should return null for grep/find commands", () => {
      const grepOutput = {
        command: "grep pattern file.ts",
        stdout: "match",
        stderr: "",
        exitCode: 0,
      };
      const findOutput = {
        command: "find . -name '*.ts'",
        stdout: "/file.ts",
        stderr: "",
        exitCode: 0,
      };

      expect(formatToolOutput("Bash", grepOutput)).toBeNull();
      expect(formatToolOutput("Bash", findOutput)).toBeNull();
    });
  });

  describe("Read/read_file output", () => {
    it("should accept both Read and read_file tool names", () => {
      const output = {
        content: "file contents here",
        filePath: "/test.ts",
      };

      const readResult = formatToolOutput("Read", output);
      const readFileResult = formatToolOutput("read_file", output);

      expect(readResult).not.toBeNull();
      expect(readFileResult).not.toBeNull();
    });

    it("should detect language from file extension", () => {
      const tsOutput = { content: "const x = 1;", filePath: "/test.ts" };
      const pyOutput = { content: "x = 1", filePath: "/test.py" };

      const tsResult = formatToolOutput("Read", tsOutput);
      const pyResult = formatToolOutput("Read", pyOutput);

      const { rerender, container } = render(<div>{tsResult}</div>);
      expect(
        container.querySelector('[data-language="typescript"]'),
      ).toBeTruthy();

      rerender(<div>{pyResult}</div>);
      expect(container.querySelector('[data-language="python"]')).toBeTruthy();
    });

    it("should render content with CodeBlock", () => {
      const output = {
        content: "const hello = 'world';",
        filePath: "/test.ts",
      };

      const result = formatToolOutput("Read", output);
      const { container } = render(<div>{result}</div>);

      expect(screen.getByTestId("code-block")).toBeTruthy();
      expect(container.textContent).toContain("const hello = 'world';");
    });
  });

  describe("Glob/Grep output", () => {
    it("should render file list from structured output", () => {
      const output = {
        pattern: "*.ts",
        files: [{ path: "/src/a.ts" }, { path: "/src/b.ts" }],
        totalMatches: 2,
      };

      const globResult = formatToolOutput("Glob", output);
      const grepResult = formatToolOutput("Grep", output);

      // Both should render file lists
      const { rerender, container } = render(<div>{globResult}</div>);
      expect(container.textContent).toContain("/src/a.ts");
      expect(container.textContent).toContain("/src/b.ts");

      rerender(<div>{grepResult}</div>);
      expect(container.textContent).toContain("/src/a.ts");
    });

    it("should show No matches found for empty results", () => {
      const output = {
        pattern: "*.xyz",
        files: [],
        totalMatches: 0,
      };

      const result = formatToolOutput("Glob", output);
      const { container } = render(<div>{result}</div>);

      expect(container.textContent).toContain("No matches found");
    });
  });

  describe("searchKnowledge output", () => {
    it("should render search results", () => {
      const output = {
        results: [
          { title: "Authentication Guide", path: "/docs/auth.md" },
          { title: "API Reference", path: "/docs/api.md" },
        ],
      };

      const result = formatToolOutput("searchKnowledge", output);
      const { container } = render(<div>{result}</div>);

      expect(container.textContent).toContain("Authentication Guide");
      expect(container.textContent).toContain("API Reference");
    });

    it("should return null for empty results", () => {
      const output = { results: [] };
      const result = formatToolOutput("searchKnowledge", output);

      // Currently returns undefined/null for empty results
      expect(result).toBeFalsy();
    });
  });

  describe("Unknown tools", () => {
    it("should return null for unrecognized tools", () => {
      const result = formatToolOutput("unknownTool", { data: "test" });
      expect(result).toBeNull();
    });
  });
});
