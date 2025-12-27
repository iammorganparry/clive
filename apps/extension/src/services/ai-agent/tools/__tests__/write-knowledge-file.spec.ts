import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { createWriteKnowledgeFileTool } from "../write-knowledge-file";
import type { KnowledgeFileService } from "../../../knowledge-file-service";
import { executeTool } from "./test-helpers";
import { createMockKnowledgeFileService } from "../../../../__tests__/mock-factories";

describe("writeKnowledgeFileTool", () => {
  let mockKnowledgeFileService: KnowledgeFileService;
  let onCompleteCallback: ((category: string, success: boolean) => void) | undefined;
  let completeCalls: Array<[string, boolean]>;

  beforeEach(() => {
    vi.clearAllMocks();
    completeCalls = [];
    onCompleteCallback = (category, success) => {
      completeCalls.push([category, success]);
    };

    // Mock KnowledgeFileService
    mockKnowledgeFileService = createMockKnowledgeFileService();
  });

  describe("Success Cases", () => {
    it("should write knowledge file successfully", async () => {
      const tool = createWriteKnowledgeFileTool(mockKnowledgeFileService);

      const result = await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
        },
        { success: false, error: "default" },
      );

      expect(result.success).toBe(true);
      // @ts-expect-error - result.relativePath is not typed
      expect(result.relativePath).toBe(".clive/knowledge/test-category.md");
      expect(mockKnowledgeFileService.writeKnowledgeFile).toHaveBeenCalledWith(
        "test-category",
        "Test Title",
        "Test content",
        {
          examples: [],
          sourceFiles: [],
          append: false,
        },
      );
    });

    it("should include examples when provided", async () => {
      const tool = createWriteKnowledgeFileTool(mockKnowledgeFileService);

      const result = await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
          examples: ["example1", "example2"],
        },
        { success: false as const, error: "default" },
      );

      expect(result.success).toBe(true);
      expect(mockKnowledgeFileService.writeKnowledgeFile).toHaveBeenCalledWith(
        "test-category",
        "Test Title",
        "Test content",
        {
          examples: ["example1", "example2"],
          sourceFiles: [],
          append: false,
        },
      );
    });

    it("should include sourceFiles when provided", async () => {
      const tool = createWriteKnowledgeFileTool(mockKnowledgeFileService);

      const result = await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
          sourceFiles: ["src/file1.ts", "src/file2.ts"],
        },
        { success: false as const, error: "default" },
      );

      expect(result.success).toBe(true);
      expect(mockKnowledgeFileService.writeKnowledgeFile).toHaveBeenCalledWith(
        "test-category",
        "Test Title",
        "Test content",
        {
          examples: [],
          sourceFiles: ["src/file1.ts", "src/file2.ts"],
          append: false,
        },
      );
    });

    it("should use append mode when append is true", async () => {
      const tool = createWriteKnowledgeFileTool(mockKnowledgeFileService);

      await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
          append: true,
        },
        { success: false },
      );

      expect(mockKnowledgeFileService.writeKnowledgeFile).toHaveBeenCalledWith(
        "test-category",
        "Test Title",
        "Test content",
        {
          examples: [],
          sourceFiles: [],
          append: true,
        },
      );
    });
  });

  describe("Callback Integration", () => {
    it("should call onComplete callback on success", async () => {
      const tool = createWriteKnowledgeFileTool(
        mockKnowledgeFileService,
        onCompleteCallback,
      );

      await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
        },
        { success: false },
      );

      expect(completeCalls.length).toBe(1);
      expect(completeCalls[0]).toEqual(["test-category", true]);
    });

    it("should call onComplete callback on error", async () => {
      const errorService = {
        writeKnowledgeFile: vi.fn(() => Effect.fail(new Error("Write failed"))),
      } as unknown as KnowledgeFileService;

      const tool = createWriteKnowledgeFileTool(errorService, onCompleteCallback);

      await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
        },
        { success: false },
      );

      expect(completeCalls.length).toBe(1);
      expect(completeCalls[0]).toEqual(["test-category", false]);
    });
  });

  describe("Error Handling", () => {
    it("should handle service errors gracefully", async () => {
      const errorService = {
        writeKnowledgeFile: vi.fn(() => Effect.fail(new Error("Write failed"))),
      } as unknown as KnowledgeFileService;

      const tool = createWriteKnowledgeFileTool(errorService);

      const result = await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
        },
        { success: false, error: "default" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Write failed");
    });

    it("should handle unknown errors", async () => {
      const errorService = {
        writeKnowledgeFile: vi.fn(() => Effect.fail("Unknown error")),
      } as unknown as KnowledgeFileService;

      const tool = createWriteKnowledgeFileTool(errorService);

      const result = await executeTool(
        tool,
        {
          category: "test-category",
          title: "Test Title",
          content: "Test content",
        },
        { success: false, error: "default" },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Category Validation", () => {
    it("should accept valid category names", async () => {
      const tool = createWriteKnowledgeFileTool(mockKnowledgeFileService);

      const validCategories = [
        "architecture",
        "user-journeys",
        "api-integrations",
        "test-patterns",
      ];

      for (const category of validCategories) {
        const result = await executeTool(
          tool,
          {
            category: category as any,
            title: "Test",
            content: "Content",
          },
          { success: false },
        );

        expect(result.success).toBe(true);
      }
    });
  });
});

