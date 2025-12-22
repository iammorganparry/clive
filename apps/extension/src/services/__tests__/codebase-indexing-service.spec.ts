import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";

// Mock AI SDK
vi.mock("ai", () => {
  // Generate embeddings with positive values to ensure positive cosine similarity
  // This prevents flaky tests where random negative values cause negative similarity
  const generateEmbedding = () =>
    Array(1536)
      .fill(0)
      .map(() => Math.random() * 0.5 + 0.1); // Values between 0.1 and 0.6 (positive)

  const mockEmbed = vi.fn().mockResolvedValue({
    embedding: generateEmbedding(),
  });

  const mockEmbedMany = vi.fn().mockImplementation(async ({ values }) => {
    // Generate one embedding per input text
    // Use similar base values with small variations to ensure positive similarity
    const baseEmbedding = generateEmbedding();
    const embeddings = values.map(() =>
      baseEmbedding.map((val) => val + (Math.random() - 0.5) * 0.2), // Small variation
    );
    return { embeddings };
  });

  return {
    embed: mockEmbed,
    embedMany: mockEmbedMany,
  };
});

vi.mock("@ai-sdk/openai", () => {
  return {
    createOpenAI: vi.fn().mockReturnValue({
      embedding: vi.fn().mockReturnValue("text-embedding-3-small"),
    }),
  };
});

vi.mock("vscode", () => {
  const mockUri = {
    file: (fsPath: string) => ({
      fsPath,
      scheme: "file",
      toString: () => `file://${fsPath}`,
    }),
    joinPath: (base: { fsPath: string }, ...segments: string[]) => {
      const path = require("node:path");
      const joined = path.join(base.fsPath, ...segments);
      return {
        fsPath: joined,
        scheme: "file",
        toString: () => `file://${joined}`,
      };
    },
  };

  return {
    default: {
      Uri: mockUri,
      workspace: {
        fs: {
          stat: vi.fn().mockResolvedValue({
            type: 1,
            ctime: Date.now(),
            mtime: Date.now(),
            size: 100,
          }),
          readFile: vi
            .fn()
            .mockResolvedValue(Buffer.from("export const test = 1;")),
        },
        findFiles: vi.fn().mockResolvedValue([]),
        workspaceFolders: [
          {
            uri: { fsPath: "/workspace", scheme: "file" },
            name: "workspace",
            index: 0,
          },
        ],
      },
    },
    Uri: mockUri,
    workspace: {
      fs: {
        stat: vi.fn().mockResolvedValue({
          type: 1,
          ctime: Date.now(),
          mtime: Date.now(),
          size: 100,
        }),
        readFile: vi
          .fn()
          .mockResolvedValue(Buffer.from("export const test = 1;")),
      },
      findFiles: vi.fn().mockResolvedValue([]),
      workspaceFolders: [
        {
          uri: { fsPath: "/workspace", scheme: "file" },
          name: "workspace",
          index: 0,
        },
      ],
    },
  };
});

vi.mock("../../lib/vscode-effects.js", () => ({
  getWorkspaceRoot: vi.fn().mockReturnValue(
    Effect.succeed({
      fsPath: "/workspace",
      scheme: "file",
      toString: () => "file:///workspace",
    }),
  ),
  getRelativePath: vi.fn().mockReturnValue(Effect.succeed("src/test.ts")),
  readFileAsStringEffect: vi
    .fn()
    .mockReturnValue(Effect.succeed("export const test = 1;")),
  findFilesEffect: vi
    .fn()
    .mockReturnValue(
      Effect.succeed([
        { fsPath: "/workspace/src/test.ts" },
        { fsPath: "/workspace/src/another.ts" },
      ]),
    ),
  NoWorkspaceFolderError: class NoWorkspaceFolderError extends Error {
    _tag = "NoWorkspaceFolderError";
  },
}));

import {
  CodebaseIndexingService,
  INDEXING_INCLUDE_PATTERNS,
  INDEXING_EXCLUDE_PATTERNS,
} from "../codebase-indexing-service.js";
import {
  createRealIndexingTestLayer,
  setAuthToken,
  setAnthropicApiKey,
  type RepositoryServiceOverrides,
  createMockWorkspace,
} from "../../__tests__/test-layer-factory.js";
import type * as vscode from "vscode";

describe("Indexing File Patterns", () => {
  describe("INDEXING_INCLUDE_PATTERNS", () => {
    it("should include TypeScript files", () => {
      expect(INDEXING_INCLUDE_PATTERNS).toContain("**/*.ts");
      expect(INDEXING_INCLUDE_PATTERNS).toContain("**/*.tsx");
    });

    it("should include JavaScript files", () => {
      expect(INDEXING_INCLUDE_PATTERNS).toContain("**/*.js");
      expect(INDEXING_INCLUDE_PATTERNS).toContain("**/*.jsx");
    });

    it("should only contain source file patterns", () => {
      expect(INDEXING_INCLUDE_PATTERNS.length).toBe(4);
    });
  });

  describe("INDEXING_EXCLUDE_PATTERNS", () => {
    it("should exclude build artifacts and dependencies", () => {
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/node_modules/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/dist/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/build/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/.next/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/out/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/coverage/**");
    });

    it("should exclude test files", () => {
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.test.ts");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.test.tsx");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.spec.ts");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.spec.tsx");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.cy.ts");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.cy.tsx");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/__tests__/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/__mocks__/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/test/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/tests/**");
    });

    it("should exclude config files", () => {
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.config.ts");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.config.js");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.config.mjs");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/vite.config.*");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/vitest.config.*");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/jest.config.*");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/tailwind.config.*");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/postcss.config.*");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/tsconfig.json");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/package.json");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/biome.json");
    });

    it("should exclude type definitions", () => {
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/*.d.ts");
    });

    it("should exclude scripts and tooling directories", () => {
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/scripts/**");
      expect(INDEXING_EXCLUDE_PATTERNS).toContain("**/tooling/**");
    });
  });
});

describe("CodebaseIndexingService", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(async () => {
    // Mock global.fetch for gateway token requests
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ token: "test-gateway-token" }),
      text: async () => "",
    } as Response);

    // Reset findFiles mock to return empty array by default
    const vscode = await import("vscode");
    vi.mocked(vscode.default.workspace.findFiles).mockResolvedValue([]);
  });

  /**
   * Create a test layer with the REAL CodebaseIndexingService.Default
   * and mocked dependencies (RepositoryService, ConfigService, etc.)
   */
  function createTestLayer(options?: {
    repoServiceOverrides?: RepositoryServiceOverrides;
    mockWorkspace?: ReturnType<typeof createMockWorkspace>;
  }) {
    // Create mock repository service with defaults + overrides
    const repoDefaults: RepositoryServiceOverrides = {
      getUserId: vi.fn().mockReturnValue(Effect.succeed("test-user-123")),
      upsertRepository: vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      getRepository: vi.fn().mockReturnValue(Effect.succeed(null)),
      upsertFile: vi.fn().mockReturnValue(Effect.void),
      deleteFile: vi.fn().mockReturnValue(Effect.void),
      getFileByPath: vi.fn().mockReturnValue(Effect.succeed(null)),
      getFileHashes: vi
        .fn()
        .mockReturnValue(Effect.succeed(new Map<string, string>())),
      searchFiles: vi.fn().mockReturnValue(Effect.succeed([])),
      getIndexingStatus: vi.fn().mockReturnValue(
        Effect.succeed({
          status: "idle" as const,
          repositoryName: null,
          repositoryPath: null,
          lastIndexedAt: null,
          fileCount: 0,
        }),
      ),
    };

    // Use the new factory that provides the REAL CodebaseIndexingService
    const ctx = createRealIndexingTestLayer({
      repositoryOverrides: {
        ...repoDefaults,
        ...options?.repoServiceOverrides,
      },
      mockWorkspace: options?.mockWorkspace,
    });

    // Pre-populate tokens
    setAuthToken(ctx.storedTokens);
    setAnthropicApiKey(ctx.storedTokens);

    return ctx.layer;
  }

  describe("computeEmbedding", () => {
    it("should compute embedding for text using AI SDK", async () => {
      const layer = createTestLayer();

      const { embedMany } = await import("ai");

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        // Access computeEmbedding through indexFile which uses it internally
        return yield* service.indexFile("src/test.ts", "repo-id");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.embedding).toHaveLength(1536);
      expect(embedMany).toHaveBeenCalled();
    });
  });

  describe("indexFile", () => {
    it("should read file, compute embedding, and store in repository", async () => {
      const layer = createTestLayer();

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        return yield* service.indexFile("src/test.ts", "repo-id");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.relativePath).toBe("src/test.ts");
      expect(result.content).toBe("export const test = 1;");
      expect(result.embedding).toHaveLength(1536);
      expect(result.fileType).toBe("ts");
    });

    it("should store in-memory when repositoryId is not provided", async () => {
      const layer = createTestLayer();

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        return yield* service.indexFile("src/test.ts");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.relativePath).toBe("src/test.ts");
    });
  });

  describe("getStatus", () => {
    it("should return idle status initially", async () => {
      const layer = createTestLayer();

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe("idle");
    });
  });

  describe("semanticSearch", () => {
    it("should compute query embedding and search repository", async () => {
      const layer = createTestLayer();

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexFile("src/test.ts");
        return yield* service.semanticSearch("test query", 10);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toHaveLength(1);
      expect(result[0].relativePath).toBe("src/test.ts");
      expect(result[0].similarity).toBeGreaterThan(0);
      expect(result[0].similarity).toBeLessThanOrEqual(1.01);
    });

    it("should fall back to in-memory search when repository search fails", async () => {
      const layer = createTestLayer({
        repoServiceOverrides: {
          searchFiles: vi
            .fn()
            .mockReturnValue(Effect.fail(new Error("DB error"))),
        },
      });

      await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexFile("src/test.ts");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        return yield* service.semanticSearch("test query", 10, "repo-id");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("indexWorkspace", () => {
    it("should find files and index them in batches", async () => {
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const layer = createTestLayer({
        repoServiceOverrides: {
          upsertRepository: upsertRepositoryMock,
        },
      });

      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(status).toBe("complete");
      expect(upsertRepositoryMock).toHaveBeenCalled();
    });

    it("should update status to error on failure", async () => {
      const upsertRepositoryMock = vi
        .fn()
        .mockReturnValue(Effect.fail(new Error("API error")));

      const layer = createTestLayer({
        repoServiceOverrides: {
          upsertRepository: upsertRepositoryMock,
        },
      });

      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service
          .indexWorkspace()
          .pipe(Effect.catchAll(() => Effect.void));
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(status).toBe("error");
    });
  });

  describe("status transitions", () => {
    it("should transition from idle -> in_progress -> complete", async () => {
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      const layer = createTestLayer({
        repoServiceOverrides: {
          upsertRepository: upsertRepositoryMock,
        },
      });

      const { initialStatus, finalStatus } = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        const initial = yield* service.getStatus();
        yield* service.indexWorkspace();
        const final = yield* service.getStatus();
        return { initialStatus: initial, finalStatus: final };
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(initialStatus).toBe("idle");
      expect(finalStatus).toBe("complete");
    });
  });

  describe("incremental sync", () => {
    it("should skip files with unchanged content hash", async () => {
      // Mock existing file hashes - hash matches current content "export const test = 1;"
      // MD5 of "export const test = 1;" is computed by the service
      const { createHash } = await import("crypto");
      const contentHash = createHash("md5")
        .update("export const test = 1;")
        .digest("hex");

      const existingHashes = new Map([["src/test.ts", contentHash]]);

      const upsertFileMock = vi.fn().mockReturnValue(Effect.void);
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      // Create mockWorkspace with findFiles mock
      const mockWorkspace = createMockWorkspace({
        findFiles: vi
          .fn()
          .mockResolvedValue([
            { fsPath: "/workspace/src/test.ts", scheme: "file" } as vscode.Uri,
          ]),
      });

      const layer = createTestLayer({
        repoServiceOverrides: {
          getFileHashes: vi
            .fn()
            .mockReturnValue(Effect.succeed(existingHashes)),
          upsertFile: upsertFileMock,
          upsertRepository: upsertRepositoryMock,
        },
        mockWorkspace,
      });

      await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // upsertFile should NOT have been called because hash matches
      expect(upsertFileMock).not.toHaveBeenCalled();
    });

    it("should re-index files with changed content hash", async () => {
      // Mock getFileHashes to return a different hash than current content
      const existingHashes = new Map([["src/test.ts", "old-hash-different"]]);
      const upsertFileMock = vi.fn().mockReturnValue(Effect.void);
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      // Create mockWorkspace with findFiles mock
      const mockWorkspace = createMockWorkspace({
        findFiles: vi
          .fn()
          .mockResolvedValue([
            { fsPath: "/workspace/src/test.ts", scheme: "file" } as vscode.Uri,
          ]),
      });

      const layer = createTestLayer({
        repoServiceOverrides: {
          getFileHashes: vi
            .fn()
            .mockReturnValue(Effect.succeed(existingHashes)),
          upsertFile: upsertFileMock,
          upsertRepository: upsertRepositoryMock,
        },
        mockWorkspace,
      });

      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // Should complete and have called upsertFile for the file (hash was different)
      expect(status).toBe("complete");
      expect(upsertFileMock).toHaveBeenCalled();
    });

    it("should index new files not in existing hashes", async () => {
      // Empty existing hashes - all files are new
      const existingHashes = new Map<string, string>();
      const upsertFileMock = vi.fn().mockReturnValue(Effect.void);
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      // Create mockWorkspace with findFiles mock
      const mockWorkspace = createMockWorkspace({
        findFiles: vi
          .fn()
          .mockResolvedValue([
            { fsPath: "/workspace/src/test.ts", scheme: "file" } as vscode.Uri,
          ]),
      });

      const layer = createTestLayer({
        repoServiceOverrides: {
          getFileHashes: vi
            .fn()
            .mockReturnValue(Effect.succeed(existingHashes)),
          upsertFile: upsertFileMock,
          upsertRepository: upsertRepositoryMock,
        },
        mockWorkspace,
      });

      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // Should complete - new files should be indexed
      expect(status).toBe("complete");
      // upsertFile should be called for the new file
      expect(upsertFileMock).toHaveBeenCalled();
    });

    it("should handle getFileHashes failure gracefully and index all files", async () => {
      const upsertFileMock = vi.fn().mockReturnValue(Effect.void);
      const upsertRepositoryMock = vi.fn().mockReturnValue(
        Effect.succeed({
          id: "test-user-123-/workspace",
          userId: "test-user-123",
          name: "workspace",
          rootPath: "/workspace",
          lastIndexedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      );

      // Create mockWorkspace with findFiles mock
      const mockWorkspace = createMockWorkspace({
        findFiles: vi
          .fn()
          .mockResolvedValue([
            { fsPath: "/workspace/src/test.ts", scheme: "file" } as vscode.Uri,
          ]),
      });

      const layer = createTestLayer({
        repoServiceOverrides: {
          // Simulate getFileHashes API error
          getFileHashes: vi
            .fn()
            .mockReturnValue(Effect.fail(new Error("API connection error"))),
          upsertFile: upsertFileMock,
          upsertRepository: upsertRepositoryMock,
        },
        mockWorkspace,
      });

      // Should not throw - should handle error gracefully and still complete
      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // Should still complete because error is handled gracefully
      expect(status).toBe("complete");
      // upsertFile should still be called (fallback to indexing all files)
      expect(upsertFileMock).toHaveBeenCalled();
    });
  });
});
