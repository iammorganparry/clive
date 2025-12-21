import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime, Layer } from "effect";

// Import deep mock for Drizzle client BEFORE importing services that use it
import "../../__mocks__/drizzle-client.js";

import { RepositoryService } from "../repository-service.js";
import { ConfigService } from "../config-service.js";
import { createMockSecretStorageLayer } from "../../__mocks__/secret-storage-service.js";
import type * as vscode from "vscode";

describe("RepositoryService", () => {
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

    // Mock JWT token with userId
    storedTokens.set(
      "clive.auth_token",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIn0.test",
    );
  });

  describe("getUserId", () => {
    it("should extract userId from JWT token via ConfigService", async () => {
      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getUserId();
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBe("test-user-123");
    });

    it("should fail when auth token is missing", async () => {
      storedTokens.delete("clive.auth_token");

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* RepositoryService;
          return yield* service.getUserId();
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).rejects.toThrow();
    });
  });

  describe("upsertRepository", () => {
    it("should create a new repository", async () => {
      const { db } = await import("@clive/db/client");
      const mockRepository = {
        id: "test-user-123-/test/path",
        userId: "test-user-123",
        name: "test-repo",
        rootPath: "/test/path",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([mockRepository]),
      };

      vi.mocked(db.insert).mockReturnValue(mockInsert as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.upsertRepository(
          "test-user-123",
          "test-repo",
          "/test/path",
        );
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.id).toBe("test-user-123-/test/path");
      expect(result.name).toBe("test-repo");
      expect(db.insert).toHaveBeenCalled();
    });

    it("should update existing repository", async () => {
      const { db } = await import("@clive/db/client");
      const existingRepo = {
        id: "test-user-123-/test/path",
        userId: "test-user-123",
        name: "old-name",
        rootPath: "/test/path",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const updatedRepo = {
        ...existingRepo,
        name: "new-name",
        updatedAt: new Date(),
      };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([updatedRepo]),
      };

      vi.mocked(db.insert).mockReturnValue(mockInsert as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.upsertRepository(
          "test-user-123",
          "new-name",
          "/test/path",
        );
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.name).toBe("new-name");
    });
  });

  describe("getRepository", () => {
    it("should return repository when it exists", async () => {
      const { db } = await import("@clive/db/client");
      const mockRepository = {
        id: "test-user-123-/test/path",
        userId: "test-user-123",
        name: "test-repo",
        rootPath: "/test/path",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockRepository]),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getRepository("test-user-123", "/test/path");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual(mockRepository);
    });

    it("should return null when repository does not exist", async () => {
      const { db } = await import("@clive/db/client");

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getRepository(
          "test-user-123",
          "/nonexistent/path",
        );
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBeNull();
    });
  });

  describe("upsertFile", () => {
    it("should store file with embedding", async () => {
      const { db } = await import("@clive/db/client");
      const mockFile = {
        relativePath: "src/test.ts",
        content: "export const test = 1;",
        embedding: Array(1536).fill(0.5),
        fileType: "ts",
        contentHash: "abc123",
      };

      const mockInsert = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(db.insert).mockReturnValue(mockInsert as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* RepositoryService;
          yield* service.upsertFile("repo-id", mockFile);
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();

      expect(db.insert).toHaveBeenCalled();
    });
  });

  describe("deleteFile", () => {
    it("should remove file from repository", async () => {
      const { db } = await import("@clive/db/client");

      const mockDelete = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(db.delete).mockReturnValue(mockDelete as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      await expect(
        Effect.gen(function* () {
          const service = yield* RepositoryService;
          yield* service.deleteFile("repo-id", "src/test.ts");
        }).pipe(Effect.provide(layer), Runtime.runPromise(runtime)),
      ).resolves.not.toThrow();

      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe("getFileByPath", () => {
    it("should retrieve file by path", async () => {
      const { db } = await import("@clive/db/client");
      const mockFile = {
        id: "repo-id-src/test.ts",
        repositoryId: "repo-id",
        relativePath: "src/test.ts",
        content: "export const test = 1;",
        embedding: Array(1536).fill(0.5),
        fileType: "ts",
        contentHash: "abc123",
        updatedAt: new Date(),
      };

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockFile]),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getFileByPath("repo-id", "src/test.ts");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toEqual(mockFile);
    });

    it("should return null when file does not exist", async () => {
      const { db } = await import("@clive/db/client");

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getFileByPath("repo-id", "src/nonexistent.ts");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toBeNull();
    });
  });

  describe("searchFiles", () => {
    it("should perform cosine distance search", async () => {
      const { db } = await import("@clive/db/client");
      const queryEmbedding = Array(1536).fill(0.5);
      const mockResults = [
        {
          id: "repo-id-src/test.ts",
          relativePath: "src/test.ts",
          content: "export const test = 1;",
          fileType: "ts",
          similarity: 0.95,
        },
      ];

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(mockResults),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.searchFiles("repo-id", queryEmbedding, 10);
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result).toHaveLength(1);
      expect(result[0].relativePath).toBe("src/test.ts");
      expect(result[0].similarity).toBe(0.95);
    });
  });

  describe("getIndexingStatus", () => {
    it("should return status with file count when repository exists", async () => {
      const { db } = await import("@clive/db/client");
      const mockRepository = {
        id: "test-user-123-/test/path",
        userId: "test-user-123",
        name: "test-repo",
        rootPath: "/test/path",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock getRepository
      const mockSelectRepo = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockRepository]),
      };

      // Mock file count
      const mockSelectCount = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 42 }]),
      };

      vi.mocked(db.select)
        .mockReturnValueOnce(mockSelectRepo as any)
        .mockReturnValueOnce(mockSelectCount as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getIndexingStatus("test-user-123", "/test/path");
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.status).toBe("complete");
      expect(result.repositoryName).toBe("test-repo");
      expect(result.fileCount).toBe(42);
    });

    it("should return idle status when repository does not exist", async () => {
      const { db } = await import("@clive/db/client");

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };

      vi.mocked(db.select).mockReturnValue(mockSelect as any);

      const layer = Layer.mergeAll(
        RepositoryService.Default,
        ConfigService.Default,
        createMockSecretStorageLayer(mockSecrets),
      );

      const result = await Effect.gen(function* () {
        const service = yield* RepositoryService;
        return yield* service.getIndexingStatus(
          "test-user-123",
          "/nonexistent/path",
        );
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect(result.status).toBe("idle");
      expect(result.repositoryName).toBeNull();
      expect(result.fileCount).toBe(0);
    });
  });
});
