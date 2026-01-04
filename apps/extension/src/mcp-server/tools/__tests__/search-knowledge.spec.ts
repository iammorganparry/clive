/**
 * searchKnowledge MCP Tool Tests
 * Tests for knowledge base search functionality
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockFileSystem,
  createMockGlob,
  setupMockEnv,
} from "../../../__tests__/mock-factories/mcp-mocks.js";

// Mock dependencies
vi.mock("node:fs/promises", () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("glob", () => ({
  glob: vi.fn(),
}));

// Import after mocks
import * as fsPromises from "node:fs/promises";
import { glob } from "glob";

// Mock MCP server
const mockTool = vi.fn();
const mockServer = {
  tool: mockTool,
};

describe("searchKnowledge MCP Tool", () => {
  let restoreEnv: () => void;
  let toolHandler: (input: { query: string; limit?: number }) => Promise<{
    content: Array<{ type: string; text: string }>;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    restoreEnv = setupMockEnv({ CLIVE_WORKSPACE: "/workspace" });

    // Reset mocks
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(glob).mockResolvedValue([]);

    // Import and register the tool
    vi.resetModules();
    const { registerSearchKnowledge } = await import("../search-knowledge.js");
    registerSearchKnowledge(mockServer as never);

    // Capture the tool handler
    toolHandler = mockTool.mock.calls[0][3];
  });

  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  describe("input validation", () => {
    it("accepts valid query and limit", async () => {
      vi.mocked(glob).mockResolvedValue([]);

      const result = await toolHandler({
        query: "authentication flow",
        limit: 10,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.query).toBe("authentication flow");
    });

    it("uses default limit of 5", async () => {
      vi.mocked(glob).mockResolvedValue([
        "1.md",
        "2.md",
        "3.md",
        "4.md",
        "5.md",
        "6.md",
        "7.md",
      ]);

      const markdown = "---\ncategory: test\ntitle: Test\n---\ntest content";
      vi.mocked(fsPromises.readFile).mockResolvedValue(markdown);

      const result = await toolHandler({ query: "test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results.length).toBeLessThanOrEqual(5);
    });
  });

  describe("file discovery", () => {
    it("finds markdown files in knowledge dir", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: test\ntitle: Test Article\n---\nTest body content",
      );

      const result = await toolHandler({ query: "test" });

      expect(glob).toHaveBeenCalledWith("**/*.md", {
        cwd: "/workspace/.clive/knowledge",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
    });

    it("returns empty when no knowledge dir", async () => {
      vi.mocked(fsPromises.access).mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );

      const result = await toolHandler({ query: "anything" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toEqual([]);
      expect(parsed.message).toBe("Knowledge directory does not exist");
    });

    it("handles missing workspace root", async () => {
      restoreEnv();
      restoreEnv = setupMockEnv({ CLIVE_WORKSPACE: undefined });

      const result = await toolHandler({ query: "anything" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toEqual([]);
      expect(parsed.error).toBe("Workspace root not set");
    });

    it("returns message when no knowledge files found", async () => {
      vi.mocked(glob).mockResolvedValue([]);

      const result = await toolHandler({ query: "anything" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toEqual([]);
      expect(parsed.message).toBe("No knowledge files found");
    });
  });

  describe("scoring algorithm", () => {
    it("scores by term frequency", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: general\ntitle: General\n---\nauthentication authentication authentication",
      );

      const result = await toolHandler({ query: "authentication" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
      expect(parsed.results[0].similarity).toBeGreaterThan(0);
    });

    it("is case-insensitive", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: test\ntitle: Test\n---\nAUTHENTICATION Flow",
      );

      const result = await toolHandler({ query: "authentication flow" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
    });

    it("splits query into multiple terms", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: auth\ntitle: Auth\n---\nuser authentication flow",
      );

      const result = await toolHandler({ query: "user flow" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.count).toBe(1);
    });

    it("boosts title matches", async () => {
      vi.mocked(glob).mockResolvedValue(["article1.md", "article2.md"]);
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(
          "---\ncategory: general\ntitle: Authentication Guide\n---\nsome content",
        )
        .mockResolvedValueOnce(
          "---\ncategory: general\ntitle: General\n---\nauthentication mentioned once",
        );

      const result = await toolHandler({ query: "authentication" });

      const parsed = JSON.parse(result.content[0].text);
      // Article with "Authentication" in title should be first
      expect(parsed.results[0].title).toBe("Authentication Guide");
    });

    it("boosts category matches", async () => {
      vi.mocked(glob).mockResolvedValue(["article1.md", "article2.md"]);
      vi.mocked(fsPromises.readFile)
        .mockResolvedValueOnce(
          "---\ncategory: authentication\ntitle: Auth Article\n---\nsome content",
        )
        .mockResolvedValueOnce(
          "---\ncategory: general\ntitle: General\n---\nauthentication mentioned",
        );

      const result = await toolHandler({ query: "authentication" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].category).toBe("authentication");
    });
  });

  describe("content handling", () => {
    it("truncates non-critical content to 500 chars", async () => {
      const longContent = "x".repeat(1000);
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        `---\ncategory: general\ntitle: General\n---\n${longContent}`,
      );

      const result = await toolHandler({ query: "x" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].content.length).toBe(500);
    });

    it("returns full content for critical categories", async () => {
      const longContent = "x".repeat(1000);
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        `---\ncategory: test-execution\ntitle: Test Execution\n---\n${longContent}`,
      );

      const result = await toolHandler({ query: "x" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].content.length).toBe(1000);
    });

    it("parses YAML frontmatter correctly", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        '---\ncategory: "test-patterns"\ntitle: "Unit Testing Best Practices"\n---\nBody content here',
      );

      const result = await toolHandler({ query: "unit testing" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].category).toBe("test-patterns");
      expect(parsed.results[0].title).toBe("Unit Testing Best Practices");
    });

    it("handles malformed frontmatter", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "No frontmatter here, just content with test word",
      );

      const result = await toolHandler({ query: "test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results[0].category).toBe("unknown");
      expect(parsed.results[0].title).toBe("Untitled");
    });
  });

  describe("edge cases", () => {
    it("empty query matches all content (includes empty string)", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: test\ntitle: Test\n---\ncontent",
      );

      const result = await toolHandler({ query: "" });

      const parsed = JSON.parse(result.content[0].text);
      // Empty string is "included" in all strings
      expect(parsed.count).toBe(1);
    });

    it("handles very large limit", async () => {
      vi.mocked(glob).mockResolvedValue(["1.md", "2.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: test\ntitle: Test\n---\ntest content",
      );

      const result = await toolHandler({ query: "test", limit: 1000 });

      const parsed = JSON.parse(result.content[0].text);
      // Should return all matching files even with large limit
      expect(parsed.count).toBe(2);
    });

    it("handles special characters in query", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        "---\ncategory: test\ntitle: Test\n---\ncontent with API/REST endpoints",
      );

      const result = await toolHandler({ query: "API/REST" });

      const parsed = JSON.parse(result.content[0].text);
      // Should not throw, may or may not match depending on tokenization
      expect(parsed).toBeDefined();
    });

    it("handles glob error gracefully", async () => {
      vi.mocked(glob).mockRejectedValue(new Error("Permission denied"));

      const result = await toolHandler({ query: "test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toEqual([]);
      expect(parsed.error).toBe("Permission denied");
    });

    it("handles file read error gracefully", async () => {
      vi.mocked(glob).mockResolvedValue(["article.md"]);
      vi.mocked(fsPromises.readFile).mockRejectedValue(
        new Error("Cannot read file"),
      );

      const result = await toolHandler({ query: "test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.error).toBe("Cannot read file");
    });
  });

  describe("tool registration", () => {
    it("registers tool with correct name and description", async () => {
      expect(mockTool).toHaveBeenCalled();
      const [name, description] = mockTool.mock.calls[0];

      expect(name).toBe("searchKnowledge");
      expect(description).toContain("Search the knowledge base");
    });
  });
});
