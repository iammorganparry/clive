import { Context, Data, Effect, Layer, pipe } from "effect";
import { WebviewMessages } from "../../constants.js";
import { VSCode, VSCodeLive } from "./vscode.js";

interface VSCodeAPI {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

export interface Session {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}

interface MessageResponse {
  command: string;
  session?: Session;
  error?: string;
  url?: string;
}

// Store pending promises for message responses
const pendingPromises = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

class AuthServiceError extends Data.TaggedError("AuthServiceError")<{
  error: string;
}> {}

// Create an Effect-based message system
const createMessageEffect = (
  vscode: VSCodeAPI,
  command: string,
  expectedResponseCommand: string
): Effect.Effect<MessageResponse, Error> => {
  return Effect.tryPromise({
    try: () => {
      return new Promise<MessageResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingPromises.delete(expectedResponseCommand);
          reject(new Error("Request timeout"));
        }, 10000);

        pendingPromises.set(expectedResponseCommand, {
          resolve: (value) => {
            clearTimeout(timeout);
            pendingPromises.delete(expectedResponseCommand);
            resolve(value as MessageResponse);
          },
          reject: (error) => {
            clearTimeout(timeout);
            pendingPromises.delete(expectedResponseCommand);
            reject(error);
          },
        });

        vscode.postMessage({ command });
      });
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
};

export interface AuthService {
  readonly checkSession: () => Effect.Effect<
    Session | undefined,
    AuthServiceError
  >;
  readonly startGitHubOAuth: () => Effect.Effect<
    string | undefined,
    AuthServiceError
  >;
  readonly logout: () => Effect.Effect<void, AuthServiceError>;
}

export class AuthServiceTag extends Context.Tag("AuthService")<
  AuthServiceTag,
  AuthService
>() {}

// Export aliases for backward compatibility
export const Auth = AuthServiceTag;
export type AuthServiceType = AuthService;

export const AuthServiceLive = Layer.effect(
  AuthServiceTag,
  Effect.gen(function* () {
    const vscode = yield* VSCode;

    const checkSession = () =>
      pipe(
        createMessageEffect(
          vscode,
          WebviewMessages.checkSession,
          WebviewMessages.sessionStatus
        ),
        Effect.mapError(
          (error) =>
            new AuthServiceError({
              error: error instanceof Error ? error.message : String(error),
            })
        ),
        Effect.flatMap((response) => {
          if (response.error) {
            return Effect.fail(
              new AuthServiceError({
                error: response.error,
              })
            );
          }
          return Effect.succeed(response.session);
        })
      );

    const startGitHubOAuth = () =>
      pipe(
        createMessageEffect(
          vscode,
          WebviewMessages.startOAuth,
          WebviewMessages.oauthCallback
        ),
        Effect.mapError(
          (error) =>
            new AuthServiceError({
              error: error instanceof Error ? error.message : String(error),
            })
        ),
        Effect.flatMap((response) => {
          if (response.error) {
            return Effect.fail(
              new AuthServiceError({
                error: response.error,
              })
            );
          }
          return Effect.succeed(response.url);
        })
      );

    const logout = () =>
      pipe(
        createMessageEffect(
          vscode,
          WebviewMessages.logout,
          WebviewMessages.loginSuccess
        ),
        Effect.mapError(
          (error) =>
            new AuthServiceError({
              error: error instanceof Error ? error.message : String(error),
            })
        ),
        Effect.flatMap((response) => {
          if (response.error) {
            return Effect.fail(
              new AuthServiceError({
                error: response.error,
              })
            );
          }
          return Effect.succeed(undefined);
        })
      );

    return { checkSession, startGitHubOAuth, logout } as const;
  })
).pipe(Layer.provide(VSCodeLive));
