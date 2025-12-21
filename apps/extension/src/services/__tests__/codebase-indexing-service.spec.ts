import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime, Layer } from "effect";

// Import deep mock for Drizzle client BEFORE importing services that use it
import drizzleMock from "../../__mocks__/drizzle-client.js";

// Mock AI SDK
vi.mock("ai", () => {
  const mockEmbed = vi.fn().mockResolvedValue({
    embedding: Array(1536)
      .fill(0)
      .map(() => Math.random() * 2 - 1),
  });

  return {
    embed: mockEmbed,
  };
});

vi.mock("@ai-sdk/openai", () => {
  return {
    createOpenAI: vi.fn().mockReturnValue({
      embedding: vi.fn().mockReturnValue("text-embedding-3-small"),
    }),
  };
});

// Mock vscode module with proper workspace.fs mocks
// This must be before importing services that use VSCodeService
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

// Mock vscode-effects to avoid direct vscode API access
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

// Import services AFTER mocks are set up
import { CodebaseIndexingService } from "../codebase-indexing-service.js";
import { RepositoryService } from "../repository-service.js";
import { ConfigService } from "../config-service.js";
import { ApiKeyService } from "../api-key-service.js";
import { createMockSecretStorageLayer } from "../../__mocks__/secret-storage-service.js";
import type * as vscode from "vscode";

describe("CodebaseIndexingService", () => {
  const runtime = Runtime.defaultRuntime;
  let mockSecrets: Partial<vscode.SecretStorage>;
  let storedTokens: Map<string, string>;

  beforeEach(() => {
    storedTokens = new Map();
    mockSecrets = {
      get: async (key: string) => {
        return storedTokens.get(key) || undefined;
      },
      store: async (key: string, value: string) => {
        storedTokens.set(key, value);
      },
      delete: async (key: string) => {
        storedTokens.delete(key);
      },
    };

    // Mock API key and auth token
    storedTokens.set("clive.anthropic_api_key", "sk-ant-api03-test-key");
    // JWT token with userId in sub claim
    storedTokens.set(
      "clive.auth_token",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIn0.test",
    );
  });

  /**
   * Helper to create a properly composed test layer.
   * The vscode module is mocked at the module level, so VSCodeService.Default
   * will use the mocked workspace.fs. We only need to provide mock layers for:
   * - SecretStorageService (for API key and auth token access)
   * - RepositoryService (for database operations)
   */
  function createTestLayer(
    repoServiceOverrides?: Parameters<
      typeof createMockRepositoryServiceWithOverrides
    >[0],
  ) {
    // Mock SecretStorageService for API key and auth token access
    const secretStorageMock = createMockSecretStorageLayer(mockSecrets);

    // Build ApiKeyService with mock SecretStorageService
    const apiKeyLayer = Layer.mergeAll(
      ApiKeyService.Default,
      secretStorageMock,
    );

    // Build ConfigService with mock dependencies
    const configLayer = Layer.mergeAll(
      ConfigService.Default,
      secretStorageMock,
      apiKeyLayer,
    );

    // Build RepositoryService mock
    const repoLayer =
      createMockRepositoryServiceWithOverrides(repoServiceOverrides);

    // Final layer: CodebaseIndexingService.Default merged with mocks
    // VSCodeService.Default uses the mocked vscode module automatically
    // Other mocks shadow the internal defaults
    return Layer.mergeAll(
      CodebaseIndexingService.Default,
      configLayer,
      repoLayer,
    );
  }

  function createMockRepositoryServiceWithOverrides(
    overrides?: Partial<{
      getUserId: ReturnType<typeof vi.fn>;
      upsertRepository: ReturnType<typeof vi.fn>;
      getRepository: ReturnType<typeof vi.fn>;
      upsertFile: ReturnType<typeof vi.fn>;
      deleteFile: ReturnType<typeof vi.fn>;
      getFileByPath: ReturnType<typeof vi.fn>;
      searchFiles: ReturnType<typeof vi.fn>;
      getIndexingStatus: ReturnType<typeof vi.fn>;
    }>,
  ) {
    const defaults = {
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

    return Layer.succeed(RepositoryService, {
      _tag: "RepositoryService",
      ...defaults,
      ...overrides,
    } as unknown as RepositoryService);
  }

  describe("computeEmbedding", () => {
    it("should compute embedding for text using AI SDK", async () => {
      const layer = createTestLayer();

      const { embed } = await import("ai");

      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        // Access computeEmbedding through indexFile which uses it internally
        return yield* service.indexFile("src/test.ts", "repo-id");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.embedding).toHaveLength(1536);
      expect(embed).toHaveBeenCalled();
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

      // Index file and search within same Effect to use same service instance
      const result = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        // First index a file to populate in-memory index
        yield* service.indexFile("src/test.ts");
        // Then search - will use in-memory search
        return yield* service.semanticSearch("test query", 10);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toHaveLength(1);
      expect(result[0].relativePath).toBe("src/test.ts");
      // Similarity will be computed based on actual embeddings (allow floating-point imprecision)
      expect(result[0].similarity).toBeGreaterThan(0);
      expect(result[0].similarity).toBeLessThanOrEqual(1.01);
    });

    it("should fall back to in-memory search when repository search fails", async () => {
      const layer = createTestLayer({
        searchFiles: vi
          .fn()
          .mockReturnValue(Effect.fail(new Error("DB error"))),
      });

      // First index a file to populate in-memory index
      await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexFile("src/test.ts");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      // Then search - should use in-memory fallback
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
      // Configure drizzle mock for upsertRepository
      const mockRepository = {
        id: "test-user-123-/workspace",
        userId: "test-user-123",
        name: "workspace",
        rootPath: "/workspace",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRepository]),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.insert.mockReturnValue(mockInsert as any);

      const layer = createTestLayer();

      // Run indexWorkspace and check status in same Effect to use same service instance
      const status = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;
        yield* service.indexWorkspace();
        return yield* service.getStatus();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(status).toBe("complete");
    });

    it("should update status to error on failure", async () => {
      // Configure drizzle mock to fail
      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockRejectedValue(new Error("Database error")),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.insert.mockReturnValue(mockInsert as any);

      const layer = createTestLayer();

      // Run indexWorkspace and check status in same Effect to use same service instance
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
      // Configure drizzle mock for upsertRepository
      const mockRepository = {
        id: "test-user-123-/workspace",
        userId: "test-user-123",
        name: "workspace",
        rootPath: "/workspace",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRepository]),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.insert.mockReturnValue(mockInsert as any);

      const layer = createTestLayer();

      // Run all status checks within same Effect to use same service instance
      const { initialStatus, finalStatus } = await Effect.gen(function* () {
        const service = yield* CodebaseIndexingService;

        // Initial status should be idle
        const initial = yield* service.getStatus();

        // Run indexWorkspace
        yield* service.indexWorkspace();

        // Final status should be complete
        const final = yield* service.getStatus();

        return { initialStatus: initial, finalStatus: final };
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(initialStatus).toBe("idle");
      expect(finalStatus).toBe("complete");
    });
  });
});
