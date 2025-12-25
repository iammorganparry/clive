import { Data, Effect } from "effect";
import * as vscode from "vscode";
import { ConfigService, type UserInfo } from "./config-service.js";

const DASHBOARD_URL = "http://localhost:3000";
const CLIENT_ID = "clive-vscode-extension";
const POLL_INTERVAL_MS = 5000;

export class DeviceAuthError extends Data.TaggedError("DeviceAuthError")<{
  message: string;
  code?: string;
}> {}

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

export interface DeviceTokenError {
  error: string;
  error_description?: string;
}

export interface UserSession {
  user: {
    id: string;
    email: string;
    name: string;
    image?: string | null;
  };
  session: {
    token: string;
    activeOrganizationId?: string | null;
  };
}

export interface DeviceAuthResult {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
}

/**
 * Service for handling device authorization flow (RFC 8628)
 * Manages the complete OAuth device flow for VS Code extension authentication
 */
export class DeviceAuthService extends Effect.Service<DeviceAuthService>()(
  "DeviceAuthService",
  {
    effect: Effect.gen(function* () {
      /**
       * Request a device code from the auth server
       */
      const requestDeviceCode = () =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[DeviceAuth] Requesting device code");

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${DASHBOARD_URL}/api/auth/device/code`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  client_id: CLIENT_ID,
                  scope: "openid profile email",
                }),
              }),
            catch: (error) =>
              new DeviceAuthError({
                message: `Failed to request device code: ${error instanceof Error ? error.message : "Unknown error"}`,
              }),
          });

          if (!response.ok) {
            const errorText = yield* Effect.tryPromise({
              try: () => response.text(),
              catch: () =>
                new DeviceAuthError({
                  message: "Failed to read error response",
                }),
            });
            return yield* Effect.fail(
              new DeviceAuthError({
                message: `Failed to request device code: ${errorText}`,
              }),
            );
          }

          const data = yield* Effect.tryPromise({
            try: () => response.json() as Promise<DeviceCodeResponse>,
            catch: () =>
              new DeviceAuthError({
                message: "Failed to parse device code response",
              }),
          });

          yield* Effect.logDebug(
            `[DeviceAuth] Got device code, user_code: ${data.user_code}`,
          );

          return data;
        });

      /**
       * Poll for token after user approves the device
       */
      const pollForToken = (deviceCode: string, onPending?: () => void) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[DeviceAuth] Polling for token");

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${DASHBOARD_URL}/api/auth/device/token`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                  device_code: deviceCode,
                  client_id: CLIENT_ID,
                }),
              }),
            catch: (error) =>
              new DeviceAuthError({
                message: `Failed to poll for token: ${error instanceof Error ? error.message : "Unknown error"}`,
              }),
          });

          const data = yield* Effect.tryPromise({
            try: () =>
              response.json() as Promise<
                DeviceTokenResponse | DeviceTokenError
              >,
            catch: () =>
              new DeviceAuthError({
                message: "Failed to parse token response",
              }),
          });

          // Check if it's an error response
          if ("error" in data) {
            const errorData = data as DeviceTokenError;

            switch (errorData.error) {
              case "authorization_pending":
                onPending?.();
                return null; // Continue polling

              case "slow_down":
                yield* Effect.logDebug(
                  "[DeviceAuth] Server requested slow down",
                );
                return null; // Continue polling with increased interval

              case "access_denied":
                return yield* Effect.fail(
                  new DeviceAuthError({
                    message: "Authorization was denied by the user",
                    code: "access_denied",
                  }),
                );

              case "expired_token":
                return yield* Effect.fail(
                  new DeviceAuthError({
                    message: "Device code has expired. Please try again.",
                    code: "expired_token",
                  }),
                );

              default:
                return yield* Effect.fail(
                  new DeviceAuthError({
                    message: errorData.error_description ?? errorData.error,
                    code: errorData.error,
                  }),
                );
            }
          }

          // Success - we have the token
          const tokenData = data as DeviceTokenResponse;
          yield* Effect.logDebug("[DeviceAuth] Got access token");

          return tokenData.access_token;
        });

      /**
       * Fetch user session using the access token
       */
      const fetchUserSession = (accessToken: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug("[DeviceAuth] Fetching user session");

          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(`${DASHBOARD_URL}/api/auth/get-session`, {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }),
            catch: (error) =>
              new DeviceAuthError({
                message: `Failed to fetch session: ${error instanceof Error ? error.message : "Unknown error"}`,
              }),
          });

          if (!response.ok) {
            return yield* Effect.fail(
              new DeviceAuthError({
                message: `Failed to fetch session: ${response.status}`,
              }),
            );
          }

          const session = yield* Effect.tryPromise({
            try: () => response.json() as Promise<UserSession>,
            catch: () =>
              new DeviceAuthError({
                message: "Failed to parse session response",
              }),
          });

          yield* Effect.logDebug(
            `[DeviceAuth] Got session for user: ${session.user.email}`,
          );

          return session;
        });

      return {
        /**
         * Start the device authorization flow
         * Returns device code info for display to user
         */
        startAuth: () =>
          Effect.gen(function* () {
            const deviceCodeResponse = yield* requestDeviceCode();

            // Open browser to verification URL
            yield* Effect.promise(() =>
              vscode.env.openExternal(
                vscode.Uri.parse(deviceCodeResponse.verification_uri_complete),
              ),
            );

            const result: DeviceAuthResult = {
              userCode: deviceCodeResponse.user_code,
              verificationUri: deviceCodeResponse.verification_uri,
              verificationUriComplete:
                deviceCodeResponse.verification_uri_complete,
            };

            return {
              ...result,
              deviceCode: deviceCodeResponse.device_code,
              expiresIn: deviceCodeResponse.expires_in,
              interval: deviceCodeResponse.interval,
            };
          }),

        /**
         * Poll for authorization completion
         * Returns true when authorization is complete and tokens are stored
         */
        pollForCompletion: (
          deviceCode: string,
          interval: number,
          signal?: AbortSignal,
        ) =>
          Effect.gen(function* () {
            const configService = yield* ConfigService;
            const pollInterval = Math.max(interval * 1000, POLL_INTERVAL_MS);

            let accessToken: string | null = null;

            while (!accessToken) {
              // Check if cancelled
              if (signal?.aborted) {
                return yield* Effect.fail(
                  new DeviceAuthError({
                    message: "Authorization cancelled",
                    code: "cancelled",
                  }),
                );
              }

              // Wait before polling
              yield* Effect.promise(
                () =>
                  new Promise((resolve) => setTimeout(resolve, pollInterval)),
              );

              // Poll for token
              accessToken = yield* pollForToken(deviceCode);
            }

            // Fetch user session
            const session = yield* fetchUserSession(accessToken);

            // Store token and user info
            yield* configService.storeAuthToken(session.session.token);

            const userInfo: UserInfo = {
              userId: session.user.id,
              email: session.user.email,
              name: session.user.name,
              image: session.user.image,
              organizationId: session.session.activeOrganizationId,
            };
            yield* configService.storeUserInfo(userInfo);

            // Fetch and cache gateway token on successful login
            yield* configService.refreshGatewayToken().pipe(
              Effect.catchAll((error) =>
                Effect.gen(function* () {
                  // Log but don't fail - gateway token can be fetched later
                  yield* Effect.logDebug(
                    `[DeviceAuth] Failed to cache gateway token: ${error instanceof Error ? error.message : "Unknown error"}`,
                  );
                }),
              ),
            );

            yield* Effect.logDebug("[DeviceAuth] Device auth flow completed");

            return userInfo;
          }),

        /**
         * Complete device authorization flow in one call:
         * 1. Request device code
         * 2. Open browser for user to approve
         * 3. Poll for token
         * 4. Fetch user session
         * 5. Store token + user info
         */
        runFullFlow: (
          onUserCode: (code: string, verificationUri: string) => void,
          onPending?: () => void,
          signal?: AbortSignal,
        ) =>
          Effect.gen(function* () {
            const configService = yield* ConfigService;

            // Step 1: Request device code
            const deviceCodeResponse = yield* requestDeviceCode();

            // Step 2: Show user code and open browser
            onUserCode(
              deviceCodeResponse.user_code,
              deviceCodeResponse.verification_uri_complete,
            );

            // Open browser to verification URL
            yield* Effect.promise(() =>
              vscode.env.openExternal(
                vscode.Uri.parse(deviceCodeResponse.verification_uri_complete),
              ),
            );

            // Step 3: Poll for token
            const pollInterval = Math.max(
              deviceCodeResponse.interval * 1000,
              POLL_INTERVAL_MS,
            );

            let accessToken: string | null = null;

            while (!accessToken) {
              // Check if cancelled
              if (signal?.aborted) {
                return yield* Effect.fail(
                  new DeviceAuthError({
                    message: "Authorization cancelled",
                    code: "cancelled",
                  }),
                );
              }

              // Wait before polling
              yield* Effect.promise(
                () =>
                  new Promise((resolve) => setTimeout(resolve, pollInterval)),
              );

              // Poll for token
              accessToken = yield* pollForToken(
                deviceCodeResponse.device_code,
                onPending,
              );
            }

            // Step 4: Fetch user session
            const session = yield* fetchUserSession(accessToken);

            // Step 5: Store token and user info
            yield* configService.storeAuthToken(session.session.token);

            const userInfo: UserInfo = {
              userId: session.user.id,
              email: session.user.email,
              name: session.user.name,
              image: session.user.image,
              organizationId: session.session.activeOrganizationId,
            };
            yield* configService.storeUserInfo(userInfo);

            yield* Effect.logDebug("[DeviceAuth] Device auth flow completed");

            return userInfo;
          }),
      };
    }),
  },
) {}

/**
 * Production layer - DeviceAuthService.Default requires ConfigService
 * ConfigService is context-specific and must be provided at the composition site.
 */
export const DeviceAuthServiceLive = DeviceAuthService.Default;
