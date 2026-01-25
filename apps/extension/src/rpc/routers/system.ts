import { createRouter } from "@clive/webview-rpc";
import { Effect, pipe } from "effect";
import * as vscode from "vscode";
import { z } from "zod";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { createSystemServiceLayer } from "../../services/layer-factory.js";
import { SourceFileFilter as SourceFileFilterService } from "../../services/source-file-filter.js";
import { VSCodeService } from "../../services/vs-code.js";
import { ensureDirectoryExists } from "../../utils/fs-effects.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Get the system layer - uses override if provided, otherwise creates default.
 * Returns a function that can be used with Effect.provide in a pipe.
 */
const provideSystemLayer = (ctx: RpcContext) => {
  const layer = ctx.systemLayer ?? createSystemServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

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

      // Get branch changes
      const branchChanges = yield* ctx.gitService.getBranchChanges();
      const sourceFileFilter = yield* SourceFileFilterService;
      const eligibleFiles = branchChanges
        ? yield* sourceFileFilter.filterEligibleFiles(branchChanges.files)
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
    }).pipe(provideSystemLayer(ctx)),
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

  /**
   * Write plan file to .clive/plans/ and open it in editor
   */
  writePlanFile: procedure
    .input(
      z.object({
        content: z.string(),
        filename: z.string().optional(),
      }),
    )
    .mutation(({ input }) =>
      Effect.gen(function* () {
        const vsCodeService = yield* VSCodeService;
        const workspaceRoot = yield* vsCodeService.getWorkspaceRoot();
        const plansDir = vsCodeService.joinPath(
          workspaceRoot,
          ".clive",
          "plans",
        );

        // Ensure .clive/plans directory exists
        yield* ensureDirectoryExists(plansDir);

        // Generate filename if not provided
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = input.filename || `test-plan-${timestamp}.md`;
        const fileUri = vsCodeService.joinPath(plansDir, filename);

        // Write file
        const contentBuffer = Buffer.from(input.content, "utf-8");
        yield* vsCodeService
          .writeFile(fileUri, contentBuffer)
          .pipe(
            Effect.mapError(
              (error) =>
                new Error(
                  error instanceof Error
                    ? error.message
                    : "Failed to write plan file",
                ),
            ),
          );

        // Open file in markdown preview mode
        yield* Effect.tryPromise({
          try: () =>
            vscode.commands.executeCommand("markdown.showPreview", fileUri),
          catch: (error) =>
            new Error(
              error instanceof Error ? error.message : "Failed to open preview",
            ),
        }).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => {
              // If opening fails, don't fail the whole operation - file was still written
              console.warn("Failed to open plan file in preview");
            }),
          ),
        );

        // Return relative path
        const relativePath = vsCodeService.asRelativePath(fileUri, false);
        return { filePath: relativePath };
      }).pipe(Effect.provide(VSCodeService.Default)),
    ),

  /**
   * Open an existing file in markdown preview mode
   */
  openFile: procedure
    .input(
      z.object({
        filePath: z.string(),
      }),
    )
    .mutation(({ input }) =>
      pipe(
        Effect.gen(function* () {
          const vsCodeService = yield* VSCodeService;
          const fileUri = yield* vsCodeService.resolveFileUri(input.filePath);
          yield* Effect.tryPromise({
            try: () =>
              vscode.commands.executeCommand("markdown.showPreview", fileUri),
            catch: (error) =>
              new Error(
                error instanceof Error
                  ? error.message
                  : "Failed to open file in preview",
              ),
          });
          return { success: true };
        }),
        Effect.catchAll((error) =>
          Effect.fail(
            new Error(
              error instanceof Error
                ? error.message
                : "Failed to open file in preview",
            ),
          ),
        ),
        Effect.provide(VSCodeService.Default),
      ),
    ),
};
