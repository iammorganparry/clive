import { createRouter } from "@clive/webview-rpc";
import { Effect } from "effect";
import { z } from "zod";
import { type AiProviderType, GlobalStateKeys } from "../../constants.js";
import { ApiKeyService } from "../../services/api-key-service.js";
import { ClaudeCliService } from "../../services/claude-cli-service.js";
import { GitService } from "../../services/git-service.js";
import { createConfigServiceLayer } from "../../services/layer-factory.js";
import { SettingsService } from "../../services/settings-service.js";
import { VSCodeService } from "../../services/vs-code.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Get the config layer - uses override if provided, otherwise creates default.
 * Returns a function that can be used with Effect.provide in a pipe.
 * The type assertion ensures compatibility with the RPC framework's expected types.
 */
const provideConfigLayer = (ctx: RpcContext) => {
  const layer = ctx.configLayer ?? createConfigServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

/**
 * Config router - handles configuration operations
 */
export const configRouter = {
  /**
   * Get API keys status
   */
  getApiKeys: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting API keys status");
      const apiKeyService = yield* ApiKeyService;
      const statuses = yield* apiKeyService.getApiKeysStatus();
      return { statuses };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[ConfigRouter] Failed to get API keys: ${errorMessage}`,
          );
          return { statuses: [], error: errorMessage };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),

  /**
   * Save API key
   */
  saveApiKey: procedure
    .input(
      z.object({
        provider: z.string(),
        key: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Saving API key for provider: ${input.provider}`,
        );
        const apiKeyService = yield* ApiKeyService;
        yield* apiKeyService.setApiKey(
          input.provider as "anthropic",
          input.key,
        );
        // Refresh and return updated status
        const statuses = yield* apiKeyService.getApiKeysStatus();
        return { statuses };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.logDebug(
              `[ConfigRouter] Failed to save API key: ${errorMessage}`,
            );
            return { statuses: [], error: errorMessage };
          }),
        ),
        provideConfigLayer(ctx),
      ),
    ),

  /**
   * Delete API key
   */
  deleteApiKey: procedure
    .input(
      z.object({
        provider: z.string(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Deleting API key for provider: ${input.provider}`,
        );
        const apiKeyService = yield* ApiKeyService;
        yield* apiKeyService.deleteApiKey(input.provider as "anthropic");
        // Refresh and return updated status
        const statuses = yield* apiKeyService.getApiKeysStatus();
        return { statuses };
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.logDebug(
              `[ConfigRouter] Failed to delete API key: ${errorMessage}`,
            );
            return { statuses: [], error: errorMessage };
          }),
        ),
        provideConfigLayer(ctx),
      ),
    ),

  /**
   * Complete onboarding
   */
  completeOnboarding: procedure
    .input(z.object({ enableIndexing: z.boolean() }))
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Completing onboarding, enableIndexing: ${input.enableIndexing}`,
        );
        const { globalState } = ctx.context;

        // Mark onboarding as complete
        yield* Effect.promise(() =>
          globalState.update(GlobalStateKeys.onboardingComplete, true),
        );

        return { success: true };
      }).pipe(provideConfigLayer(ctx)),
    ),

  /**
   * Get base branch configuration
   * Returns user-configured base branch and auto-detected base branch
   */
  getBaseBranch: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[ConfigRouter] Getting base branch configuration",
      );
      const settingsService = yield* SettingsService;
      const gitService = yield* GitService;
      const vscode = yield* VSCodeService;

      // Get user-configured base branch (null if not set)
      const userConfigured = yield* settingsService.getBaseBranch();

      // Get auto-detected base branch
      const workspaceFolders = vscode.workspace.workspaceFolders;
      let autoDetected = "main"; // default fallback
      if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        autoDetected = yield* gitService.getBaseBranch(workspaceRoot);
      }

      return {
        baseBranch: userConfigured,
        autoDetected,
      };
    }).pipe(provideConfigLayer(ctx)),
  ),

  /**
   * Set base branch configuration
   * Pass null to use auto-detection
   */
  setBaseBranch: procedure
    .input(
      z.object({
        branch: z.string().nullable(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Setting base branch: ${input.branch ?? "auto-detect"}`,
        );
        const settingsService = yield* SettingsService;
        yield* settingsService.setBaseBranch(input.branch);

        // Return updated configuration
        const gitService = yield* GitService;
        const vscode = yield* VSCodeService;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let autoDetected = "main";
        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          autoDetected = yield* gitService.getBaseBranch(workspaceRoot);
        }

        return {
          baseBranch: input.branch,
          autoDetected,
        };
      }).pipe(
        Effect.catchTags({
          SettingsError: (error) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[ConfigRouter] SettingsError in setBaseBranch: ${error.message} (operation: ${error.operation})`,
              );
              return {
                baseBranch: null,
                autoDetected: "main",
                error: error.message,
              };
            }),
        }),
        provideConfigLayer(ctx),
      ),
    ),

  /**
   * Get terminal command approval setting
   */
  getTerminalCommandApproval: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[ConfigRouter] Getting terminal command approval setting",
      );
      const settingsService = yield* SettingsService;
      const approval = yield* settingsService.getTerminalCommandApproval();
      return { approval };
    }).pipe(provideConfigLayer(ctx)),
  ),

  /**
   * Set terminal command approval setting
   */
  setTerminalCommandApproval: procedure
    .input(
      z.object({
        approval: z.enum(["always", "auto"]),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Setting terminal command approval: ${input.approval}`,
        );
        const settingsService = yield* SettingsService;
        yield* settingsService.setTerminalCommandApproval(input.approval);
        return { approval: input.approval };
      }).pipe(
        Effect.catchTags({
          SettingsError: (error) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[ConfigRouter] SettingsError in setTerminalCommandApproval: ${error.message} (operation: ${error.operation})`,
              );
              return {
                approval: "always" as const,
                error: error.message,
              };
            }),
        }),
        provideConfigLayer(ctx),
      ),
    ),

  /**
   * Get AI provider preference
   */
  getAiProvider: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting AI provider");
      const settingsService = yield* SettingsService;
      const provider = yield* settingsService.getAiProvider();
      return { provider };
    }).pipe(provideConfigLayer(ctx)),
  ),

  /**
   * Set AI provider preference
   */
  setAiProvider: procedure
    .input(
      z.object({
        provider: z.enum(["anthropic", "gateway", "claude-cli"]),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug(
          `[ConfigRouter] Setting AI provider: ${input.provider}`,
        );
        const settingsService = yield* SettingsService;
        yield* settingsService.setAiProvider(input.provider as AiProviderType);

        // Manage MCP bridge lifecycle based on provider
        const bridgeRuntime = ctx.mcpBridgeRuntime;
        if (bridgeRuntime) {
          if (input.provider === "claude-cli") {
            // Start bridge when Claude CLI is selected
            yield* Effect.tryPromise({
              try: () => bridgeRuntime.start(),
              catch: (error) =>
                new Error(
                  `Failed to start MCP bridge: ${error instanceof Error ? error.message : "Unknown error"}`,
                ),
            }).pipe(
              Effect.tap((socketPath) =>
                Effect.logDebug(
                  `[ConfigRouter] MCP bridge started at: ${socketPath}`,
                ),
              ),
              Effect.catchAll((error) =>
                Effect.logDebug(
                  `[ConfigRouter] Failed to start MCP bridge: ${error.message}`,
                ),
              ),
            );
          } else {
            // Stop bridge when switching away from Claude CLI
            yield* Effect.tryPromise({
              try: () => bridgeRuntime.stop(),
              catch: () => new Error("Failed to stop MCP bridge"),
            }).pipe(
              Effect.tap(() =>
                Effect.logDebug("[ConfigRouter] MCP bridge stopped"),
              ),
              Effect.catchAll((error) =>
                Effect.logDebug(
                  `[ConfigRouter] Failed to stop MCP bridge: ${error.message}`,
                ),
              ),
            );
          }
        }

        return { provider: input.provider };
      }).pipe(
        Effect.catchTags({
          SettingsError: (error) =>
            Effect.gen(function* () {
              yield* Effect.logDebug(
                `[ConfigRouter] SettingsError in setAiProvider: ${error.message} (operation: ${error.operation})`,
              );
              return {
                provider: "gateway" as const,
                error: error.message,
              };
            }),
        }),
        provideConfigLayer(ctx),
      ),
    ),

  /**
   * Get Claude CLI status (installed, authenticated, version)
   */
  getClaudeCliStatus: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting Claude CLI status");
      const cliService = yield* ClaudeCliService;
      const status = yield* cliService.detectCli();
      return status;
    }).pipe(
      Effect.catchAllDefect((defect) =>
        Effect.gen(function* () {
          const errorMessage =
            defect instanceof Error ? defect.message : "Unknown error";
          yield* Effect.logDebug(
            `[ConfigRouter] Failed to get Claude CLI status: ${errorMessage}`,
          );
          return {
            installed: false,
            path: null,
            authenticated: false,
            version: null,
            error: errorMessage,
          };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),

  /**
   * Trigger Claude CLI authentication flow
   */
  authenticateClaudeCli: procedure.input(z.void()).mutation(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug(
        "[ConfigRouter] Triggering Claude CLI authentication",
      );
      const cliService = yield* ClaudeCliService;
      const success = yield* cliService.authenticate();
      return { success };
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[ConfigRouter] Failed to authenticate Claude CLI: ${errorMessage}`,
          );
          return {
            success: false,
            error: errorMessage,
          };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),

  /**
   * Get MCP bridge connection status
   */
  getMcpBridgeStatus: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[ConfigRouter] Getting MCP bridge status");
      const bridgeRuntime = ctx.mcpBridgeRuntime;

      if (!bridgeRuntime) {
        return {
          bridgeReady: false,
          starting: false,
          error: null,
          socketPath: null,
        };
      }

      const status = yield* Effect.tryPromise({
        try: () => bridgeRuntime.getStatus(),
        catch: (error) =>
          new Error(
            `Failed to get MCP bridge status: ${error instanceof Error ? error.message : "Unknown error"}`,
          ),
      });

      return status;
    }).pipe(
      Effect.catchAll((error) =>
        Effect.gen(function* () {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          yield* Effect.logDebug(
            `[ConfigRouter] Failed to get MCP bridge status: ${errorMessage}`,
          );
          return {
            bridgeReady: false,
            starting: false,
            error: errorMessage,
            socketPath: null,
          };
        }),
      ),
      provideConfigLayer(ctx),
    ),
  ),
};
