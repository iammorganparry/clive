import { Effect } from "effect";
import { z } from "zod";
import * as vscode from "vscode";
import { createRouter } from "@clive/webview-rpc";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { createAuthServiceLayer } from "../../services/layer-factory.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

const userInfoSchema = z.object({
  userId: z.string(),
  email: z.string().optional(),
  name: z.string().optional(),
  image: z.string().optional(),
  organizationId: z.string().optional(),
});

/**
 * Get the auth layer - uses override if provided, otherwise creates default.
 * Returns a function that can be used with Effect.provide in a pipe.
 */
const provideAuthLayer = (ctx: RpcContext) => {
  const layer = ctx.authLayer ?? createAuthServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

/**
 * Auth router - handles authentication operations
 */
export const authRouter = {
  /**
   * Open login page in browser
   */
  openLogin: procedure
    .input(
      z.object({
        url: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        const callbackUrl = "vscode://clive.auth/callback";
        const loginUrl =
          input.url ||
          `http://localhost:3000/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`;
        yield* Effect.promise(() =>
          vscode.env.openExternal(vscode.Uri.parse(loginUrl)),
        );
      }).pipe(provideAuthLayer(ctx)),
    ),

  /**
   * Open signup page in browser
   */
  openSignup: procedure
    .input(
      z.object({
        url: z.string().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        const callbackUrl = "vscode://clive.auth/callback";
        const signupUrl =
          input.url ||
          `http://localhost:3000/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`;
        yield* Effect.promise(() =>
          vscode.env.openExternal(vscode.Uri.parse(signupUrl)),
        );
      }).pipe(provideAuthLayer(ctx)),
    ),

  /**
   * Check session - returns stored auth token and user info
   */
  checkSession: procedure.input(z.void()).query(({ ctx }) =>
    Effect.gen(function* () {
      const configService = yield* ConfigServiceEffect;
      const token = yield* configService.getAuthToken();
      const userInfo = yield* configService.getUserInfo();
      return { token: token || null, userInfo: userInfo || null };
    }).pipe(provideAuthLayer(ctx)),
  ),

  /**
   * Logout - clears auth token and user info
   */
  logout: procedure.input(z.void()).mutation(({ ctx }) =>
    Effect.gen(function* () {
      const configService = yield* ConfigServiceEffect;
      yield* configService.deleteAuthToken();
      yield* configService.deleteUserInfo();
      // OIDC gateway tokens are fetched on-demand, no need to clear them
    }).pipe(provideAuthLayer(ctx)),
  ),

  /**
   * Store auth token and user info to secret storage
   */
  storeToken: procedure
    .input(
      z.object({
        token: z.string(),
        userInfo: userInfoSchema.optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      Effect.gen(function* () {
        yield* Effect.logDebug("[AuthRouter] Storing auth token and user info");
        const configService = yield* ConfigServiceEffect;
        yield* configService.storeAuthToken(input.token);
        if (input.userInfo) {
          yield* configService.storeUserInfo(input.userInfo);
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const errorMessage =
              error instanceof Error ? error.message : "Unknown error";
            yield* Effect.logDebug(
              `[AuthRouter] Failed to store auth token in secret storage: ${errorMessage}`,
            );
            yield* Effect.sync(() => {
              ctx.outputChannel.appendLine(
                `Failed to store auth token in secret storage: ${errorMessage}`,
              );
            });
          }),
        ),
        provideAuthLayer(ctx),
      ),
    ),
};
