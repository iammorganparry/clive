import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";
import * as vscode from "vscode";
import {
  PendingEditService,
  setPendingEditServiceInstance,
  getPendingEditServiceInstance,
  acceptEditAsync,
  rejectEditAsync,
  registerPendingEditSync,
} from "../pending-edit-service.js";

// Mock vscode module
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import("../../__tests__/mock-factories");
  const baseMock = createVSCodeMock();
  
  // Add EventEmitter to the mock
  class MockEventEmitter {
    private listeners: Array<() => void> = [];
    
    event = (listener: () => void) => {
      this.listeners.push(listener);
      return { dispose: vi.fn() };
    };
    
    fire = () => {
      this.listeners.forEach(listener => {
        listener();
      });
    };
    
    dispose = vi.fn();
  }
  
  return {
    ...baseMock,
    EventEmitter: MockEventEmitter,
  };
});

describe("PendingEditService", () => {
  const runtime = Runtime.defaultRuntime;
  let mockFs: {
    writeFile: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mock file system with delete method
    const mockWriteFile = vi.fn().mockResolvedValue(undefined);
    const mockDelete = vi.fn().mockResolvedValue(undefined);

    mockFs = {
      writeFile: mockWriteFile,
      delete: mockDelete,
    };

    // Override the fs object in vscode.workspace
    Object.defineProperty(vscode.workspace, "fs", {
      value: mockFs,
      writable: true,
      configurable: true,
    });
  });

  describe("registerPendingEdit", () => {
    it("should register a new pending edit", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original content",
          false,
        );

        const hasPending = yield* service.hasPendingEdit("/test/file.ts");
        expect(hasPending).toBe(true);

        const edit = yield* service.getPendingEdit("/test/file.ts");
        expect(edit).toEqual({
          filePath: "/test/file.ts",
          originalContent: "original content",
          isNewFile: false,
          timestamp: expect.any(Number),
        });
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should fire change event when edit registered", async () => {
      const eventFired = vi.fn();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Subscribe to change event
        service.onDidChangePendingEdits(eventFired);

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original content",
          false,
        );

        // Wait a tick for event to propagate
        yield* Effect.sleep(0);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(eventFired).toHaveBeenCalled();
    });

    it("should preserve original content when same file edited multiple times", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // First edit
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "first original",
          false,
        );

        // Second edit to same file (should NOT update original)
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "second content",
          false,
        );

        const edit = yield* service.getPendingEdit("/test/file.ts");
        expect(edit?.originalContent).toBe("first original");
        expect(edit?.originalContent).not.toBe("second content");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should track new file vs existing file correctly", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit("/test/new.ts", "", true);
        yield* service.registerPendingEdit(
          "/test/existing.ts",
          "content",
          false,
        );

        const newFileEdit = yield* service.getPendingEdit("/test/new.ts");
        const existingFileEdit = yield* service.getPendingEdit(
          "/test/existing.ts",
        );

        expect(newFileEdit?.isNewFile).toBe(true);
        expect(existingFileEdit?.isNewFile).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("acceptEdit", () => {
    it("should remove edit from pending and return true", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
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

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
          false,
        );

        eventFired.mockClear(); // Clear the register event

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

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
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

  describe("rejectEdit", () => {
    it("should restore original content for existing file", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original content",
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
        Buffer.from("original content", "utf-8"),
      );
    });

    it("should delete file for new file (isNewFile=true)", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit("/test/new.ts", "", true);

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

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
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

          yield* service.registerPendingEdit(
            "/test/file.ts",
            "original",
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

          yield* service.registerPendingEdit("/test/new.ts", "", true);
          yield* service.rejectEdit("/test/new.ts");
        }).pipe(
          Effect.provide(PendingEditService.Default),
          Runtime.runPromise(runtime),
        ),
      ).rejects.toThrow();
    });
  });

  describe("hasPendingEdit / hasPendingEditSync", () => {
    it("should return true when file has pending edit", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
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

    it("should return false when file has no pending edit", async () => {
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

        yield* service.registerPendingEdit(
          "/test/file1.ts",
          "original",
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

  describe("getPendingEdit", () => {
    it("should return edit info when exists", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original content",
          false,
        );

        const edit = yield* service.getPendingEdit("/test/file.ts");

        expect(edit).toEqual({
          filePath: "/test/file.ts",
          originalContent: "original content",
          isNewFile: false,
          timestamp: expect.any(Number),
        });
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should return undefined when not exists", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;
        const edit = yield* service.getPendingEdit("/test/nonexistent.ts");
        expect(edit).toBeUndefined();
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });

  describe("getPendingEditPaths", () => {
    it("should return all paths with pending edits", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit("/test/file1.ts", "content1", false);
        yield* service.registerPendingEdit("/test/file2.ts", "content2", false);
        yield* service.registerPendingEdit("/test/file3.ts", "content3", true);

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

        yield* service.registerPendingEdit("/test/file1.ts", "content1", false);
        count = yield* service.getPendingEditCount();
        expect(count).toBe(1);

        yield* service.registerPendingEdit("/test/file2.ts", "content2", false);
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
    it("should remove all pending edits", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit("/test/file1.ts", "content1", false);
        yield* service.registerPendingEdit("/test/file2.ts", "content2", false);
        yield* service.registerPendingEdit("/test/file3.ts", "content3", false);

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

        yield* service.registerPendingEdit("/test/file1.ts", "content1", false);

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
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
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
        yield* service.registerPendingEdit(
          "/test/file.ts",
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

    it("registerPendingEditSync should work correctly", async () => {
      const service = await Effect.gen(function* () {
        return yield* PendingEditService;
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      setPendingEditServiceInstance(service);

      registerPendingEditSync("/test/file.ts", "original content", false);

      const hasPending = await Effect.gen(function* () {
        return yield* service.hasPendingEdit("/test/file.ts");
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );

      expect(hasPending).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle multiple operations on same file correctly", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
          false,
        );

        // Try to register again (should preserve original)
        yield* service.registerPendingEdit(
          "/test/file.ts",
          "different",
          false,
        );

        const edit = yield* service.getPendingEdit("/test/file.ts");
        expect(edit?.originalContent).toBe("original");

        // Accept
        const accepted = yield* service.acceptEdit("/test/file.ts");
        expect(accepted).toBe(true);

        // Can't accept again
        const acceptedAgain = yield* service.acceptEdit("/test/file.ts");
        expect(acceptedAgain).toBe(false);
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });

    it("should handle concurrent operations", async () => {
      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        // Register multiple files concurrently
        yield* Effect.all([
          service.registerPendingEdit("/test/file1.ts", "content1", false),
          service.registerPendingEdit("/test/file2.ts", "content2", false),
          service.registerPendingEdit("/test/file3.ts", "content3", false),
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

    it("should properly track timestamps", async () => {
      const now = Date.now();

      await Effect.gen(function* () {
        const service = yield* PendingEditService;

        yield* service.registerPendingEdit(
          "/test/file.ts",
          "original",
          false,
        );

        const edit = yield* service.getPendingEdit("/test/file.ts");
        expect(edit?.timestamp).toBeGreaterThanOrEqual(now);
        expect(edit?.timestamp).toBeLessThanOrEqual(Date.now());
      }).pipe(
        Effect.provide(PendingEditService.Default),
        Runtime.runPromise(runtime),
      );
    });
  });
});
