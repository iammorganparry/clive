import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";
import * as vscodeModule from "vscode";
import {
  PendingEditService,
  setPendingEditServiceInstance,
  getPendingEditServiceInstance,
  acceptEditAsync,
  rejectEditAsync,
  acceptBlockAsync,
  rejectBlockAsync,
  registerBlockSync,
} from "../pending-edit-service.js";
import {
  createMockVSCodeServiceLayer,
  type createVSCodeMock,
} from "../../__tests__/mock-factories/index.js";

// Mock vscode globally for pending-edit-service which uses vscode.* directly
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../__tests__/mock-factories/vscode-mock.js"
  );
  return createVSCodeMock();
});

describe("PendingEditService", () => {
  const runtime = Runtime.defaultRuntime;
  let _mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let mockVscode: ReturnType<typeof createVSCodeMock>;
  let mockFs: {
    writeFile: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock VSCodeService layer
    const { layer, mockVscode: vsMock } = createMockVSCodeServiceLayer();
    _mockVSCodeServiceLayer = layer;
    mockVscode = vsMock;

    // Setup mock file system with delete method
    // Use the global mock's fs methods (the actual code uses vscode.workspace.fs directly)
    const _globalMockFs = (vscodeModule as unknown as typeof mockVscode)
      .workspace.fs as unknown as {
      writeFile: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };

    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    const mockDelete = vi.fn().mockResolvedValue(undefined);

    mockFs = {
      writeFile: mockWriteFile,
      delete: mockDelete,
    };

    // Override the fs object in the global mock (used by PendingEditService)
    Object.defineProperty(
      (vscodeModule as unknown as typeof mockVscode).workspace,
      "fs",
      {
        value: mockFs,
        writable: true,
        configurable: true,
      },
    );

    // Mock openTextDocument for rejectBlock
    const mockOpenTextDocument = vi.fn().mockResolvedValue({
      getText: () =>
        "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10",
    });

    Object.defineProperty(mockVscode.workspace, "openTextDocument", {
      value: mockOpenTextDocument,
      writable: true,
      configurable: true,
    });
  });

  describe("registerBlock", () => {
    it("should register a single block for a file", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          15,
          ["original line 10", "original line 11"],
          3,
          "base content",
          false,
        );

        const hasPending = yield* service.hasPendingEdit("/test/file.ts");
        expect(hasPending).toBe(true);

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual({
          blockId: "block-1",
          filePath: "/test/file.ts",
          startLine: 10,
          endLine: 15,
          originalLines: ["original line 10", "original line 11"],
          newLineCount: 3,
          timestamp: expect.any(Number),
        });
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should register multiple blocks for the same file", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10", "line 11", "line 12"],
          2,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["line 20", "line 21", "line 22"],
          4,
          undefined,
          false,
        );

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(2);
        expect(blocks[0].blockId).toBe("block-1");
        expect(blocks[1].blockId).toBe("block-2");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should sort blocks by startLine", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register blocks out of order
        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["line 20"],
          1,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          undefined,
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-3",
          30,
          32,
          ["line 30"],
          1,
          undefined,
          false,
        );

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(3);
        expect(blocks[0].blockId).toBe("block-1");
        expect(blocks[0].startLine).toBe(10);
        expect(blocks[1].blockId).toBe("block-2");
        expect(blocks[1].startLine).toBe(20);
        expect(blocks[2].blockId).toBe("block-3");
        expect(blocks[2].startLine).toBe(30);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event when block registered", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });
  });

  describe("acceptBlock", () => {
    it("should remove specific block from tracking", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["line 20"],
          1,
          undefined,
          false,
        );

        const accepted = yield* service.acceptBlock("/test/file.ts", "block-1");
        expect(accepted).toBe(true);

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(1);
        expect(blocks[0].blockId).toBe("block-2");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should remove file from tracking when last block accepted", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        const accepted = yield* service.acceptBlock("/test/file.ts", "block-1");
        expect(accepted).toBe(true);

        const hasPending = yield* service.hasPendingEdit("/test/file.ts");
        expect(hasPending).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event when block accepted", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        eventFired.mockClear();

        yield* service.acceptBlock("/test/file.ts", "block-1");
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });

    it("should return false for non-existent block", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const accepted = yield* service.acceptBlock(
          "/test/file.ts",
          "nonexistent",
        );
        expect(accepted).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("acceptEdit", () => {
    it("should remove all blocks for file from tracking", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["line 20"],
          1,
          undefined,
          false,
        );

        const accepted = yield* service.acceptEdit("/test/file.ts");
        expect(accepted).toBe(true);

        const hasPending = yield* service.hasPendingEdit("/test/file.ts");
        expect(hasPending).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event when edit accepted", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        eventFired.mockClear();

        yield* service.acceptEdit("/test/file.ts");
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });

    it("should return false for non-existent edit", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const accepted = yield* service.acceptEdit("/test/nonexistent.ts");
        expect(accepted).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should not modify the file (keeps current content)", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        yield* service.acceptEdit("/test/file.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      // File system should not be called for accept
      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.delete).not.toHaveBeenCalled();
    });
  });

  describe("rejectBlock", () => {
    it("should revert specific block's lines", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register a block (lines 3-4 were changed, originally 2 lines)
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["original line 3", "original line 4"],
          3,
          "base content",
          false,
        );

        const rejected = yield* service.rejectBlock("/test/file.ts", "block-1");
        expect(rejected).toBe(true);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      // Should have written file with reverted content
      expect(mockFs.writeFile).toHaveBeenCalled();
    });

    it("should update subsequent block positions after rejection", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register two blocks
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          2,
          4,
          ["original line 2", "original line 3"],
          3,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          7,
          9,
          ["original line 7"],
          2,
          undefined,
          false,
        );

        // Reject first block (reduces total lines)
        yield* service.rejectBlock("/test/file.ts", "block-1");

        // Second block should have adjusted line numbers
        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(1);
        expect(blocks[0].blockId).toBe("block-2");
        // Line shift: originalLines.length (2) - newLineCount (3) = -1
        // So block-2's startLine should shift from 7 to 6
        expect(blocks[0].startLine).toBe(6);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should remove file from tracking when last block rejected", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["original line 3", "original line 4"],
          3,
          "base content",
          false,
        );

        const rejected = yield* service.rejectBlock("/test/file.ts", "block-1");
        expect(rejected).toBe(true);

        const hasPending = yield* service.hasPendingEdit("/test/file.ts");
        expect(hasPending).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event when block rejected", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["original line 3"],
          3,
          "base content",
          false,
        );

        eventFired.mockClear();

        yield* service.rejectBlock("/test/file.ts", "block-1");
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });

    it("should return false for non-existent block", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const rejected = yield* service.rejectBlock(
          "/test/file.ts",
          "nonexistent",
        );
        expect(rejected).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });
  });

  describe("rejectEdit", () => {
    it("should restore original base content for existing file", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["line 3"],
          3,
          "original base content",
          false,
        );

        const rejected = yield* service.rejectEdit("/test/file.ts");
        expect(rejected).toBe(true);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: "/test/file.ts" }),
        Buffer.from("original base content", "utf-8"),
      );
    });

    it("should delete file for new file (isNewFile=true)", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/new.ts",
          "block-1",
          1,
          5,
          [],
          5,
          "",
          true,
        );

        const rejected = yield* service.rejectEdit("/test/new.ts");
        expect(rejected).toBe(true);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(mockFs.delete).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: "/test/new.ts" }),
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it("should fire change event when edit rejected", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["line 3"],
          3,
          "base content",
          false,
        );

        eventFired.mockClear();

        yield* service.rejectEdit("/test/file.ts");
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });

    it("should return false for non-existent edit", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const rejected = yield* service.rejectEdit("/test/nonexistent.ts");
        expect(rejected).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(mockFs.writeFile).not.toHaveBeenCalled();
      expect(mockFs.delete).not.toHaveBeenCalled();
    });

    it("should handle file write errors gracefully", async () => {
      mockFs.writeFile.mockRejectedValue(new Error("Write failed"));

      await expect(
        Effect.gen(function* () {
          const service = yield* PendingEditService;

          yield* service.registerBlock(
            "/test/file.ts",
            "block-1",
            3,
            5,
            ["line 3"],
            3,
            "base content",
            false,
          );

          yield* service.rejectEdit("/test/file.ts");
        }).pipe(
          Effect.provide(PendingEditService.Default),
          Runtime.runPromise(runtime),
        ),
      ).rejects.toThrow();
    });

    it("should handle file delete errors gracefully", async () => {
      mockFs.delete.mockRejectedValue(new Error("Delete failed"));

      await expect(
        Effect.gen(function* () {
          const service = yield* PendingEditService;

          yield* service.registerBlock(
            "/test/new.ts",
            "block-1",
            1,
            5,
            [],
            5,
            "",
            true,
          );

          yield* service.rejectEdit("/test/new.ts");
        }).pipe(
          Effect.provide(PendingEditService.Default),
          Runtime.runPromise(runtime),
        ),
      ).rejects.toThrow();
    });
  });

  describe("hasPendingEdit / hasPendingEditSync", () => {
    it("should return true when file has pending blocks", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        const hasAsync = yield* service.hasPendingEdit("/test/file.ts");
        const hasSync = service.hasPendingEditSync("/test/file.ts");

        expect(hasAsync).toBe(true);
        expect(hasSync).toBe(true);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should return false when file has no pending blocks", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        const hasAsync = yield* service.hasPendingEdit("/test/file.ts");
        const hasSync = service.hasPendingEditSync("/test/file.ts");

        expect(hasAsync).toBe(false);
        expect(hasSync).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("both sync and async versions should return same result", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file1.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        const asyncResult1 = yield* service.hasPendingEdit("/test/file1.ts");
        const syncResult1 = service.hasPendingEditSync("/test/file1.ts");
        expect(asyncResult1).toBe(syncResult1);

        const asyncResult2 = yield* service.hasPendingEdit("/test/file2.ts");
        const syncResult2 = service.hasPendingEditSync("/test/file2.ts");
        expect(asyncResult2).toBe(syncResult2);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("getBlocksForFile / getBlocksForFileSync", () => {
    it("should return blocks when they exist", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["original line 10", "original line 11"],
          3,
          "base content",
          false,
        );

        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["original line 20"],
          2,
          undefined,
          false,
        );

        const blocksAsync = yield* service.getBlocksForFile("/test/file.ts");
        const blocksSync = service.getBlocksForFileSync("/test/file.ts");

        expect(blocksAsync).toHaveLength(2);
        expect(blocksSync).toHaveLength(2);
        expect(blocksAsync[0].blockId).toBe("block-1");
        expect(blocksAsync[1].blockId).toBe("block-2");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should return empty array when no blocks exist", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        const blocksAsync = yield* service.getBlocksForFile(
          "/test/nonexistent.ts",
        );
        const blocksSync = service.getBlocksForFileSync("/test/nonexistent.ts");

        expect(blocksAsync).toEqual([]);
        expect(blocksSync).toEqual([]);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("getPendingEditPaths", () => {
    it("should return all paths with pending blocks", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file1.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content1",
          false,
        );
        yield* service.registerBlock(
          "/test/file2.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content2",
          false,
        );
        yield* service.registerBlock(
          "/test/file3.ts",
          "block-1",
          1,
          5,
          [],
          5,
          "",
          true,
        );

        const paths = yield* service.getPendingEditPaths();

        expect(paths).toHaveLength(3);
        expect(paths).toContain("/test/file1.ts");
        expect(paths).toContain("/test/file2.ts");
        expect(paths).toContain("/test/file3.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should return empty array when no edits", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const paths = yield* service.getPendingEditPaths();
        expect(paths).toEqual([]);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("getPendingEditCount", () => {
    it("should return correct count", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        let count = yield* service.getPendingEditCount();
        expect(count).toBe(0);

        yield* service.registerBlock(
          "/test/file1.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content1",
          false,
        );
        count = yield* service.getPendingEditCount();
        expect(count).toBe(1);

        yield* service.registerBlock(
          "/test/file2.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content2",
          false,
        );
        count = yield* service.getPendingEditCount();
        expect(count).toBe(2);

        yield* service.acceptEdit("/test/file1.ts");
        count = yield* service.getPendingEditCount();
        expect(count).toBe(1);

        yield* service.rejectEdit("/test/file2.ts");
        count = yield* service.getPendingEditCount();
        expect(count).toBe(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("clearAllPendingEdits", () => {
    it("should remove all pending blocks", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file1.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content1",
          false,
        );
        yield* service.registerBlock(
          "/test/file2.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content2",
          false,
        );
        yield* service.registerBlock(
          "/test/file3.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content3",
          false,
        );

        let count = yield* service.getPendingEditCount();
        expect(count).toBe(3);

        yield* service.clearAllPendingEdits();

        count = yield* service.getPendingEditCount();
        expect(count).toBe(0);

        const paths = yield* service.getPendingEditPaths();
        expect(paths).toEqual([]);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerBlock(
          "/test/file1.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "content1",
          false,
        );

        eventFired.mockClear();

        yield* service.clearAllPendingEdits();
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });
  });

  describe("Singleton accessors", () => {
    it("getPendingEditServiceInstance should throw when not initialized", () => {
      // Clear any existing instance
      setPendingEditServiceInstance(null as unknown as PendingEditService);

      expect(() => getPendingEditServiceInstance()).toThrow(
        "PendingEditService not initialized",
      );
    });

    it("setPendingEditServiceInstance should set the instance", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);
      const retrieved = getPendingEditServiceInstance();

      expect(retrieved).toBe(service);
    });

    it("acceptEditAsync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      await Effect.gen(function* () {
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      const result = await acceptEditAsync("/test/file.ts");
      expect(result).toBe(true);

      const hasPending = await Effect.gen(function* () {
        return yield* service.hasPendingEdit("/test/file.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(hasPending).toBe(false);
    });

    it("rejectEditAsync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      await Effect.gen(function* () {
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "original",
          false,
        );
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      const result = await rejectEditAsync("/test/file.ts");
      expect(result).toBe(true);

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.objectContaining({ fsPath: "/test/file.ts" }),
        Buffer.from("original", "utf-8"),
      );
    });

    it("registerBlockSync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      registerBlockSync(
        "/test/file.ts",
        "block-1",
        10,
        12,
        ["original line 10"],
        2,
        "base content",
        false,
      );

      const hasPending = await Effect.gen(function* () {
        return yield* service.hasPendingEdit("/test/file.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(hasPending).toBe(true);
    });

    it("acceptBlockAsync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      await Effect.gen(function* () {
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      const result = await acceptBlockAsync("/test/file.ts", "block-1");
      expect(result).toBe(true);

      const hasPending = await Effect.gen(function* () {
        return yield* service.hasPendingEdit("/test/file.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(hasPending).toBe(false);
    });

    it("rejectBlockAsync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      await Effect.gen(function* () {
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          3,
          5,
          ["original line 3"],
          3,
          "base content",
          false,
        );
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      const result = await rejectBlockAsync("/test/file.ts", "block-1");
      expect(result).toBe(true);

      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple blocks on same file correctly", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register multiple blocks
        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );
        yield* service.registerBlock(
          "/test/file.ts",
          "block-2",
          20,
          22,
          ["line 20"],
          1,
          undefined,
          false,
        );

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks).toHaveLength(2);

        // Accept first block
        const accepted = yield* service.acceptBlock("/test/file.ts", "block-1");
        expect(accepted).toBe(true);

        // Should still have second block
        const remainingBlocks =
          yield* service.getBlocksForFile("/test/file.ts");
        expect(remainingBlocks).toHaveLength(1);
        expect(remainingBlocks[0].blockId).toBe("block-2");

        // Can't accept first block again (it was already removed)
        // acceptBlock returns true if the file exists, even if the specific block doesn't
        const acceptedAgain = yield* service.acceptBlock(
          "/test/file.ts",
          "block-1",
        );
        expect(acceptedAgain).toBe(true); // File still exists, so returns true
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should handle concurrent block operations", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register multiple blocks concurrently
        yield* Effect.all([
          service.registerBlock(
            "/test/file1.ts",
            "block-1",
            10,
            12,
            ["line 10"],
            1,
            "content1",
            false,
          ),
          service.registerBlock(
            "/test/file2.ts",
            "block-1",
            10,
            12,
            ["line 10"],
            1,
            "content2",
            false,
          ),
          service.registerBlock(
            "/test/file3.ts",
            "block-1",
            10,
            12,
            ["line 10"],
            1,
            "content3",
            false,
          ),
        ]);

        const count = yield* service.getPendingEditCount();
        expect(count).toBe(3);

        // Accept and reject concurrently
        yield* Effect.all([
          service.acceptEdit("/test/file1.ts"),
          service.rejectEdit("/test/file2.ts"),
        ]);

        const finalCount = yield* service.getPendingEditCount();
        expect(finalCount).toBe(1);

        const has3 = yield* service.hasPendingEdit("/test/file3.ts");
        expect(has3).toBe(true);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should properly track timestamps for blocks", async () => {
      const now = Date.now();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerBlock(
          "/test/file.ts",
          "block-1",
          10,
          12,
          ["line 10"],
          1,
          "base content",
          false,
        );

        const blocks = yield* service.getBlocksForFile("/test/file.ts");
        expect(blocks[0].timestamp).toBeGreaterThanOrEqual(now);
        expect(blocks[0].timestamp).toBeLessThanOrEqual(Date.now());
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });
});
