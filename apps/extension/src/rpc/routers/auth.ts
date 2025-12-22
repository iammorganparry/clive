import { Effect, Runtime } from "effect";
import { z } from "zod";
import * as vscode from "vscode";
import { createRouter } from "@clive/webview-rpc";
import { ConfigService as ConfigServiceEffect } from "../../services/config-service.js";
import { createAuthServiceLayer } from "../../services/layer-factory.js";
import { DeviceAuthService } from "../../services/device-auth-service.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

const userInfoSchema = z.object({
  userId: z.string(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  organizationId: z.string().nullable().optional(),
});

// Track active device auth sessions
const activeDeviceAuthSessions = new Map<
  string,
  { cancel: () => void; deviceCode: string }
>();

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
   * Start device authorization flow (RFC 8628)
   * Returns a device code for the user to enter in the browser
   */
  startDeviceAuth: procedure.input(z.void()).mutation(({ ctx }) =>
    Effect.gen(function* () {
      yield* Effect.logDebug("[AuthRouter] Starting device authorization");

      const deviceAuthService = yield* DeviceAuthService;

      // Start auth and get device code info
      const authInfo = yield* deviceAuthService.startAuth();

      // Generate a session ID for tracking
      const sessionId = `device-${Date.now()}`;

      // Create abort controller for cancellation
      const abortController = new AbortController();

      // Store the session
      activeDeviceAuthSessions.set(sessionId, {
        cancel: () => abortController.abort(),
        deviceCode: authInfo.deviceCode,
      });

      // Start polling in background (don't await)
      const layer = ctx.authLayer ?? createAuthServiceLayer(ctx.layerContext);

      const pollEffect = Effect.gen(function* () {
        const deviceAuth = yield* DeviceAuthService;

        yield* deviceAuth.pollForCompletion(
          authInfo.deviceCode,
          authInfo.interval,
          abortController.signal,
        );

        yield* Effect.logDebug("[AuthRouter] Device auth completed");

        // Cleanup
        activeDeviceAuthSessions.delete(sessionId);
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            yield* Effect.logDebug(
              `[AuthRouter] Device auth error: ${error instanceof Error ? error.message : "Unknown"}`,
            );
            activeDeviceAuthSessions.delete(sessionId);
          }),
        ),
        Effect.provide(layer),
      );

      // Run polling in background
      Runtime.runPromise(Runtime.defaultRuntime)(pollEffect);

      return {
        sessionId,
        userCode: authInfo.userCode,
        verificationUri: authInfo.verificationUri,
        verificationUriComplete: authInfo.verificationUriComplete,
        expiresIn: authInfo.expiresIn,
      };
    }).pipe(provideAuthLayer(ctx)),
  ),

  /**
   * Cancel an active device authorization session
   */
  cancelDeviceAuth: procedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) =>
      Effect.gen(function* () {
        const session = activeDeviceAuthSessions.get(input.sessionId);
        if (session) {
          session.cancel();
          activeDeviceAuthSessions.delete(input.sessionId);
          yield* Effect.logDebug(
            `[AuthRouter] Cancelled device auth session: ${input.sessionId}`,
          );
        }
      }),
    ),

  /**
   * Open login page in browser (legacy - kept for compatibility)
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
   * Open signup page in browser (legacy - kept for compatibility)
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
