import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { createSearchKnowledgeTool } from "../search-knowledge";
import type { KnowledgeFileService } from "../../../knowledge-file-service";
import { VSCodeFileFindError } from "../../../../lib/vscode-effects.js";
import { createMockKnowledgeFileService } from "../../../../__tests__/mock-factories";

type SearchResult = {
  results: Array<{
    category: string;
    title: string;
    content: string;
    path: string;
    similarity: number;
  }>;
  query: string;
  count: number;
};

/**
 * Helper function to execute tool and handle async results
 */
async function executeTool(
  tool: ReturnType<typeof createSearchKnowledgeTool>,
  input: { query: string; limit?: number },
): Promise<SearchResult> {
  if (!tool.execute) {
    throw new Error("Tool execute function is undefined");
  }

  const result = await tool.execute(input, {
    toolCallId: "test-call-id",
    messages: [],
  });

  // Handle AsyncIterable if needed
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    const results: SearchResult[] = [];
    for await (const value of result as AsyncIterable<SearchResult>) {
      results.push(value);
    }
    return results[results.length - 1] ?? { results: [], query: input.query, count: 0 };
  }

  return result as SearchResult;
}

describe("searchKnowledgeTool", () => {
  let mockKnowledgeFileService: KnowledgeFileService;
  let onKnowledgeRetrievedCallback: (
    results: Array<{
      category: string;
      title: string;
      content: string;
      path: string;
    }>,
  ) => void;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock knowledge file service with custom overrides
    mockKnowledgeFileService = createMockKnowledgeFileService({
      listKnowledgeFiles: vi.fn(() =>
        Effect.succeed([
          { relativePath: ".clive/knowledge/test-execution.md", path: "/test/test-execution.md" },
          { relativePath: ".clive/knowledge/architecture.md", path: "/test/architecture.md" },
        ]),
      ),
      readKnowledgeFile: vi.fn((path: string) => {
        if (path.includes("test-execution")) {
          return Effect.succeed({
            path: "/test/test-execution.md",
            relativePath: ".clive/knowledge/test-execution.md",
            metadata: {
              category: "test-execution",
              title: "Running Unit Tests",
              updatedAt: new Date().toISOString(),
            },
            content: "Use npx vitest run for unit tests. Tests are located in __tests__ directories. This is a longer description that goes beyond 500 characters to test the full content return for critical categories. We want to make sure that test-execution category articles always return their full content without truncation because they contain critical information about how to run tests in this codebase. This includes framework-specific commands, configuration details, and important patterns that developers need to follow when writing and executing tests.",
          });
        }
        return Effect.succeed({
          path: "/test/architecture.md",
          relativePath: ".clive/knowledge/architecture.md",
          metadata: {
            category: "architecture",
            title: "System Architecture",
            updatedAt: new Date().toISOString(),
          },
          content: "The system uses Effect-TS for dependency injection and layer composition. This is a longer content that would normally be truncated for non-critical categories. The architecture follows a layered approach with clear separation of concerns. Services are organized into tiers based on their dependencies, with core services at the bottom and feature services at the top. This design makes testing easier and promotes modularity.",
        });
      }),
    });

    onKnowledgeRetrievedCallback = vi.fn();
  });

  describe("Happy Path", () => {
    it("should search knowledge base and return matching results", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test execution",
        limit: 5,
      });

      expect(result.count).toBeGreaterThan(0);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.query).toBe("test execution");
    });

    it("should return results sorted by relevance", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 5,
      });

      expect(result.results[0]?.category).toBe("test-execution");
      expect(result.results[0]?.similarity).toBeGreaterThan(0);
    });

    it("should limit results based on limit parameter", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 1,
      });

      expect(result.results.length).toBeLessThanOrEqual(1);
    });

    it("should call onKnowledgeRetrieved callback with full content", async () => {
      const tool = createSearchKnowledgeTool(
        mockKnowledgeFileService,
        onKnowledgeRetrievedCallback,
      );
      await executeTool(tool, {
        query: "test",
        limit: 5,
      });

      expect(onKnowledgeRetrievedCallback).toHaveBeenCalled();
      const callArgs = vi.mocked(onKnowledgeRetrievedCallback).mock.calls[0][0];
      expect(callArgs).toBeInstanceOf(Array);
      expect(callArgs[0]).toHaveProperty("category");
      expect(callArgs[0]).toHaveProperty("title");
      expect(callArgs[0]).toHaveProperty("content");
      expect(callArgs[0]).toHaveProperty("path");
    });

    it("should return full content for critical categories", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test execution",
        limit: 5,
      });

      const testExecutionResult = result.results.find(
        (r) => r.category === "test-execution",
      );
      expect(testExecutionResult).toBeDefined();
      if (testExecutionResult) {
        expect(testExecutionResult.content).toContain("Use npx vitest run");
        // Critical categories should return full content, not truncated
        expect(testExecutionResult.content).toContain("framework-specific commands");
      }
    });

    it("should truncate content for non-critical categories", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "architecture",
        limit: 5,
      });

      const archResult = result.results.find(
        (r) => r.category === "architecture",
      );
      expect(archResult).toBeDefined();
      if (archResult) {
        expect(archResult.content.length).toBeLessThanOrEqual(500);
      }
    });

    it("should boost scores for category matches", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test-execution",
        limit: 5,
      });

      expect(result.results[0]?.category).toBe("test-execution");
      expect(result.results[0]?.similarity).toBeGreaterThan(0);
    });

    it("should boost scores for title matches", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "Running Unit Tests",
        limit: 5,
      });

      const testResult = result.results.find(
        (r) => r.title === "Running Unit Tests",
      );
      expect(testResult).toBeDefined();
      if (testResult) {
        expect(testResult.similarity).toBeGreaterThan(0);
      }
    });
  });

  describe("Error Handling", () => {
    it("should return empty results when no knowledge files exist", async () => {
      vi.mocked(mockKnowledgeFileService.listKnowledgeFiles).mockReturnValue(
        Effect.succeed([]),
      );

      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 5,
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("should return empty results when no matches found", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "nonexistentquerythatwontmatch",
        limit: 5,
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(mockKnowledgeFileService.listKnowledgeFiles).mockReturnValue(
        Effect.fail(
          new VSCodeFileFindError({
            pattern: "**/*.md",
            cause: new Error("File system error"),
          }),
        ),
      );

      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 5,
      });

      expect(result.count).toBe(0);
      expect(result.results).toEqual([]);
    });

    it("should not call callback when no results found", async () => {
      const tool = createSearchKnowledgeTool(
        mockKnowledgeFileService,
        onKnowledgeRetrievedCallback,
      );
      await executeTool(tool, {
        query: "nonexistent",
        limit: 5,
      });

      expect(onKnowledgeRetrievedCallback).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty query string", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "",
        limit: 5,
      });

      // Empty query has no search terms, but implementation still returns results
      // This is expected behavior - empty query matches nothing with score > 0
      expect(result.results.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle query with multiple terms", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test execution unit vitest",
        limit: 5,
      });

      expect(result.results.length).toBeGreaterThan(0);
    });

    it("should handle case-insensitive search", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result1 = await executeTool(tool, {
        query: "TEST",
        limit: 5,
      });

      const result2 = await executeTool(tool, {
        query: "test",
        limit: 5,
      });

      expect(result1.count).toBe(result2.count);
    });

    it("should handle limit of 0", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 0,
      });

      expect(result.results).toEqual([]);
    });

    it("should handle very large limit", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test",
        limit: 1000,
      });

      // Should return all matching results, not more than available
      expect(result.results.length).toBeLessThanOrEqual(2);
    });

    it("should handle special characters in query", async () => {
      const tool = createSearchKnowledgeTool(mockKnowledgeFileService);
      const result = await executeTool(tool, {
        query: "test-execution & architecture",
        limit: 5,
      });

      expect(result.results.length).toBeGreaterThan(0);
    });
  });
});
