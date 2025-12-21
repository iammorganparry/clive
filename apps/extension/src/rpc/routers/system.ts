import { Effect, Layer } from "effect";
import { z } from "zod";
import * as vscode from "vscode";
import { createRouter } from "@clive/webview-rpc";
import { ReactFileFilter as ReactFileFilterService } from "../../services/react-file-filter.js";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import {
  VSCodeService,
  createSecretStorageLayer,
} from "../../services/vs-code.js";
import { createLoggerLayer } from "../../services/logger-service.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Helper to create the service layer from context
 */
function createServiceLayer(ctx: RpcContext) {
  return Layer.mergeAll(
    ReactFileFilterService.Default,
    ConfigServiceEffect.Default,
    VSCodeService.Default,
    createSecretStorageLayer(ctx.context),
    createLoggerLayer(ctx.outputChannel, ctx.isDev),
  );
}

/**
 * System router - handles system-level operations
 */
export const systemRouter = {
  /**
   * Ready - returns initial state (cypress status, branch changes, theme, auth token)
   */
  ready: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[SystemRouter] Handling ready message");

      // Get Cypress status
      const cypressStatus = yield* Effect.tryPromise({
        try: () => ctx.cypressDetector.checkStatus(),
        catch: (error) =>
          new Error(error instanceof Error ? error.message : "Unknown error"),
      });

      // Get branch changes
      const branchChanges = yield* ctx.gitService.getBranchChanges();
      const reactFileFilter = yield* ReactFileFilterService;
      const eligibleFiles = branchChanges
        ? yield* reactFileFilter.filterEligibleFiles(branchChanges.files)
        : [];

      // Get theme
      const colorTheme = vscode.window.activeColorTheme;
      const colorScheme =
        colorTheme.kind === vscode.ColorThemeKind.Dark ||
        colorTheme.kind === vscode.ColorThemeKind.HighContrast
          ? "dark"
          : "light";

      // Get auth token
      const configService = yield* ConfigServiceEffect;
      const token = yield* configService.getAuthToken();

      return {
        cypressStatus: cypressStatus || {
          overallStatus: "not_installed" as const,
          packages: [],
          workspaceRoot: "",
        },
        branchChanges: branchChanges
          ? {
              branchName: branchChanges.branchName,
              baseBranch: branchChanges.baseBranch,
              files: eligibleFiles,
              workspaceRoot: branchChanges.workspaceRoot,
            }
          : null,
        theme: {
          colorScheme,
        },
        authToken: token || null,
      };
    }).pipe(Effect.provide(createServiceLayer(ctx))),
  ),

  /**
   * Log - logs message to output channel
   */
  log: procedure
    .input(
      z.object({
        level: z.string().optional(),
        message: z.string(),
        data: z.unknown().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.sync(() => {
        if (!ctx.outputChannel) {
          return;
        }

        const level = input.level || "info";
        const logMessage = input.data
          ? `${input.message}: ${JSON.stringify(input.data, null, 2)}`
          : input.message;
        ctx.outputChannel.appendLine(`[${level.toUpperCase()}] ${logMessage}`);
      }),
    ),

  /**
   * Get theme - returns current VS Code theme
   */
  getTheme: procedure.input(z.void()).query(() =>
    Effect.sync(() => {
      const colorTheme = vscode.window.activeColorTheme;
      const colorScheme =
        colorTheme.kind === vscode.ColorThemeKind.Dark ||
        colorTheme.kind === vscode.ColorThemeKind.HighContrast
          ? "dark"
          : "light";

      return { colorScheme };
    }),
  ),
};
