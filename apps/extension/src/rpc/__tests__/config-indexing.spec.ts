import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime, Layer } from "effect";

import drizzleMock from "../../__mocks__/drizzle-client.js";

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
  findFilesEffect: vi.fn().mockReturnValue(Effect.succeed([])),
  NoWorkspaceFolderError: class NoWorkspaceFolderError extends Error {
    _tag = "NoWorkspaceFolderError";
  },
}));

import { configRouter } from "../routers/config.js";
import { ConfigService } from "../../services/config-service.js";
import { ApiKeyService } from "../../services/api-key-service.js";
import { RepositoryService } from "../../services/repository-service.js";
import { CodebaseIndexingService } from "../../services/codebase-indexing-service.js";
import { VSCodeService } from "../../services/vs-code.js";
import { createMockSecretStorageLayer } from "../../__mocks__/secret-storage-service.js";
import { createLoggerLayer } from "../../services/logger-service.js";
import type * as vscode from "vscode";
import type { RpcContext } from "../context.js";

describe("Config Router - Indexing Endpoints", () => {
  const runtime = Runtime.defaultRuntime;
  let mockSecrets: Partial<vscode.SecretStorage>;
  let storedTokens: Map<string, string>;
  let mockContext: RpcContext;

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

    storedTokens.set(
      "clive.auth_token",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXItMTIzIn0.test",
    );
    storedTokens.set("clive.anthropic_api_key", "sk-ant-api03-test-key");

    mockContext = {
      context: {
        secrets: mockSecrets as vscode.SecretStorage,
      } as vscode.ExtensionContext,
      outputChannel: {
        appendLine: vi.fn(),
        show: vi.fn(),
      } as unknown as vscode.OutputChannel,
      isDev: false,
      webviewView: {
        webview: {
          postMessage: vi.fn(),
        },
      } as unknown as vscode.WebviewView,
      cypressDetector: {
        checkStatus: vi.fn().mockResolvedValue({
          overallStatus: "installed" as const,
          packages: [],
          workspaceRoot: "/test",
        }),
      } as unknown as RpcContext["cypressDetector"],
      gitService: {
        getBranchChanges: vi.fn().mockResolvedValue(null),
      } as unknown as RpcContext["gitService"],
      reactFileFilter: {} as unknown as RpcContext["reactFileFilter"],
      diffProvider: {} as unknown as RpcContext["diffProvider"],
      configService: {} as unknown as RpcContext["configService"],
    } as unknown as RpcContext;
  });

  function createMockVSCodeLayer() {
    const mockWorkspace = {
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
    } as unknown as vscode.Workspace;

    return Layer.succeed(VSCodeService, {
      _tag: "VSCodeService",
      workspace: mockWorkspace,
    });
  }

  function createMockRepositoryService(
    overrides: Partial<{
      getUserId: ReturnType<typeof vi.fn>;
      upsertRepository: ReturnType<typeof vi.fn>;
      upsertFile: ReturnType<typeof vi.fn>;
      getRepository: ReturnType<typeof vi.fn>;
      deleteFile: ReturnType<typeof vi.fn>;
      getFileByPath: ReturnType<typeof vi.fn>;
      getIndexingStatus: ReturnType<typeof vi.fn>;
      searchFiles: ReturnType<typeof vi.fn>;
    }> = {},
  ) {
    const defaults = {
      getUserId: vi.fn().mockReturnValue(Effect.succeed("test-user-123")),
      upsertRepository: vi.fn().mockReturnValue(Effect.succeed({})),
      upsertFile: vi.fn().mockReturnValue(Effect.void),
      getRepository: vi.fn().mockReturnValue(Effect.succeed(null)),
      deleteFile: vi.fn().mockReturnValue(Effect.void),
      getFileByPath: vi.fn().mockReturnValue(Effect.succeed(null)),
      getIndexingStatus: vi.fn().mockReturnValue(
        Effect.succeed({
          status: "idle" as const,
          repositoryName: null,
          repositoryPath: null,
          lastIndexedAt: null,
          fileCount: 0,
        }),
      ),
      searchFiles: vi.fn().mockReturnValue(Effect.succeed([])),
    };

    return Layer.succeed(RepositoryService, {
      _tag: "RepositoryService",
      ...defaults,
      ...overrides,
    } as unknown as RepositoryService);
  }

  function createMockIndexingService(
    overrides: Partial<{
      indexFile: ReturnType<typeof vi.fn>;
      indexWorkspace: ReturnType<typeof vi.fn>;
      semanticSearch: ReturnType<typeof vi.fn>;
      getStatus: ReturnType<typeof vi.fn>;
    }> = {},
  ) {
    const defaults = {
      indexFile: vi.fn().mockReturnValue(Effect.succeed({})),
      indexWorkspace: vi.fn().mockReturnValue(Effect.void),
      semanticSearch: vi.fn().mockReturnValue(Effect.succeed([])),
      getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
    };

    return Layer.succeed(CodebaseIndexingService, {
      _tag: "CodebaseIndexingService",
      ...defaults,
      ...overrides,
    } as unknown as CodebaseIndexingService);
  }

  describe("getIndexingStatus", () => {
    it("should return merged status from repo and in-memory state", async () => {
      const mockRepository = {
        id: "test-user-123-/workspace",
        userId: "test-user-123",
        name: "workspace",
        rootPath: "/workspace",
        lastIndexedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([mockRepository]),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.select.mockReturnValue(mockSelect as any);

      const mockSelectCount = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ count: 42 }]),
      };
      drizzleMock.select
        // biome-ignore lint/suspicious/noExplicitAny: Test mock type
        .mockReturnValueOnce(mockSelect as any)
        // biome-ignore lint/suspicious/noExplicitAny: Test mock type
        .mockReturnValueOnce(mockSelectCount as any);

      const repoLayer = createMockRepositoryService({
        getRepository: vi.fn().mockReturnValue(
          Effect.succeed({
            id: "repo-id",
            userId: "test-user-123",
            name: "workspace",
            rootPath: "/workspace",
            lastIndexedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
        getIndexingStatus: vi.fn().mockReturnValue(
          Effect.succeed({
            status: "complete" as const,
            repositoryName: "workspace",
            repositoryPath: "/workspace",
            lastIndexedAt: new Date(),
            fileCount: 42,
          }),
        ),
      });

      const indexingLayer = createMockIndexingService({
        getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
      });

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { status: string }).status).toBe("complete");
      expect((result as { repositoryName: string }).repositoryName).toBe(
        "workspace",
      );
      expect((result as { fileCount: number }).fileCount).toBe(42);
    });

    it("should return idle when no repository exists and no indexing in progress", async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.select.mockReturnValue(mockSelect as any);

      const repoLayer = createMockRepositoryService({
        getIndexingStatus: vi.fn().mockReturnValue(
          Effect.succeed({
            status: "idle" as const,
            repositoryName: null,
            repositoryPath: null,
            lastIndexedAt: null,
            fileCount: 0,
          }),
        ),
      });

      const indexingLayer = createMockIndexingService({
        getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
      });

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { status: string }).status).toBe("idle");
    });

    it("should handle RepositoryError", async () => {
      const mockSelect = {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockRejectedValue(new Error("Database connection failed")),
      };
      // biome-ignore lint/suspicious/noExplicitAny: Test mock type
      drizzleMock.select.mockReturnValue(mockSelect as any);

      const repoLayer = createMockRepositoryService({
        getIndexingStatus: vi.fn().mockReturnValue(
          Effect.fail({
            _tag: "RepositoryError",
            message: "Database connection failed",
          }),
        ),
      });

      const indexingLayer = createMockIndexingService();

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { status: string }).status).toBe("error");
      expect((result as { errorMessage: string }).errorMessage).toBe(
        "Database connection failed",
      );
    });

    it("should handle AuthTokenMissingError", async () => {
      storedTokens.delete("clive.auth_token");

      const repoLayer = createMockRepositoryService();
      const indexingLayer = createMockIndexingService();

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { status: string }).status).toBe("error");
      expect((result as { errorMessage: string }).errorMessage).toContain(
        "Authentication required",
      );
    });
  });

  describe("triggerReindex", () => {
    it("should fork indexing in background and return success", async () => {
      const repoLayer = createMockRepositoryService();
      const indexingLayer = createMockIndexingService();

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.triggerReindex._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { success: boolean }).success).toBe(true);
    });

    it("should return success even when errors occur", async () => {
      const repoLayer = createMockRepositoryService();
      const indexingLayer = createMockIndexingService({
        indexWorkspace: vi
          .fn()
          .mockReturnValue(Effect.fail(new Error("Indexing failed"))),
      });

      const layer = Layer.mergeAll(
        ConfigService.Default,
        ApiKeyService.Default,
        repoLayer,
        indexingLayer,
        createMockVSCodeLayer(),
        createMockSecretStorageLayer(mockSecrets),
        createLoggerLayer(mockContext.outputChannel, mockContext.isDev),
      );

      const handler = configRouter.triggerReindex._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, unknown>;

      const result = await handler({
        ctx: mockContext,
        input: undefined,
      }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));

      expect((result as { success: boolean }).success).toBe(true);
    });
  });
});
