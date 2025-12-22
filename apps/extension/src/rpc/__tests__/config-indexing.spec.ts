import { Effect, Runtime } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import type * as vscode from "vscode";
import {
  createConfigTestLayer,
  setAnthropicApiKey,
  setAuthToken,
} from "../../__tests__/test-layer-factory.js";
import type { RpcContext } from "../context.js";
import type { LayerContext } from "../../services/layer-factory.js";
import { configRouter } from "../routers/config.js";

/**
 * Create a mock LayerContext for testing.
 * This is only used as a fallback - tests should provide configLayer directly.
 */
const createMockLayerContext = (): LayerContext => ({
  extensionContext: {} as vscode.ExtensionContext,
  outputChannel: { appendLine: vi.fn() } as unknown as vscode.OutputChannel,
  isDev: false,
});

describe("Config Router - Indexing Endpoints", () => {
  const runtime = Runtime.defaultRuntime;
  let testContext: ReturnType<typeof createConfigTestLayer>;
  let mockContext: RpcContext;

  beforeEach(() => {
    testContext = createConfigTestLayer();

    // Pre-populate tokens
    setAuthToken(testContext.storedTokens);
    setAnthropicApiKey(testContext.storedTokens);

    mockContext = {
      context: {
        secrets: testContext.mockSecrets as unknown as vscode.SecretStorage,
      } as vscode.ExtensionContext,
      outputChannel:
        testContext.mockOutputChannel as unknown as vscode.OutputChannel,
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
        getBranchChanges: vi.fn().mockReturnValue(Effect.succeed(null)),
      },
      diffProvider: {} as unknown as RpcContext["diffProvider"],
      // Layer context (fallback) and layer override for testing
      layerContext: createMockLayerContext(),
      configLayer: testContext.layer,
    } as unknown as RpcContext;
  });

  describe("getIndexingStatus", () => {
    it("should return merged status from repo and in-memory state", async () => {
      // Create test layer with custom overrides
      const ctx = createConfigTestLayer({
        repositoryOverrides: {
          getIndexingStatus: vi.fn().mockReturnValue(
            Effect.succeed({
              status: "complete" as const,
              repositoryName: "workspace",
              repositoryPath: "/workspace",
              lastIndexedAt: new Date(),
              fileCount: 42,
            }),
          ),
        },
        indexingOverrides: {
          getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
        },
      });
      setAuthToken(ctx.storedTokens);

      // Inject the test layer via context
      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { status: string }).status).toBe("complete");
      expect((result as { repositoryName: string }).repositoryName).toBe(
        "workspace",
      );
      expect((result as { fileCount: number }).fileCount).toBe(42);
    });

    it("should return idle when no repository exists and no indexing in progress", async () => {
      const ctx = createConfigTestLayer({
        repositoryOverrides: {
          getIndexingStatus: vi.fn().mockReturnValue(
            Effect.succeed({
              status: "idle" as const,
              repositoryName: null,
              repositoryPath: null,
              lastIndexedAt: null,
              fileCount: 0,
            }),
          ),
        },
        indexingOverrides: {
          getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
        },
      });
      setAuthToken(ctx.storedTokens);

      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { status: string }).status).toBe("idle");
    });

    it("should handle RepositoryError", async () => {
      const ctx = createConfigTestLayer({
        repositoryOverrides: {
          getIndexingStatus: vi.fn().mockReturnValue(
            Effect.fail({
              _tag: "RepositoryError",
              message: "API connection failed",
            }),
          ),
        },
      });
      setAuthToken(ctx.storedTokens);

      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { status: string }).status).toBe("error");
      expect((result as { errorMessage: string }).errorMessage).toBe(
        "API connection failed",
      );
    });

    it("should handle AuthTokenMissingError", async () => {
      // Create context WITHOUT setting auth token
      const ctx = createConfigTestLayer();
      // Don't set auth token - ctx.storedTokens is empty

      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.getIndexingStatus._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { status: string }).status).toBe("error");
      expect((result as { errorMessage: string }).errorMessage).toContain(
        "Authentication required",
      );
    });
  });

  describe("triggerReindex", () => {
    it("should fork indexing in background and return success", async () => {
      const ctx = createConfigTestLayer();
      setAuthToken(ctx.storedTokens);

      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.triggerReindex._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { success: boolean }).success).toBe(true);
    });

    it("should return success even when errors occur", async () => {
      const ctx = createConfigTestLayer({
        indexingOverrides: {
          indexWorkspace: vi
            .fn()
            .mockReturnValue(Effect.fail(new Error("Indexing failed"))),
        },
      });
      setAuthToken(ctx.storedTokens);

      const testMockContext = {
        ...mockContext,
        configLayer: ctx.layer,
      };

      const handler = configRouter.triggerReindex._def.handler as (opts: {
        ctx: RpcContext;
        input: undefined;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({
          ctx: testMockContext,
          input: undefined,
        }),
      );

      expect((result as { success: boolean }).success).toBe(true);
    });
  });
});
