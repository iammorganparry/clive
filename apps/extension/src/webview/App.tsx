import React, { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Effect, pipe, Runtime, Layer } from "effect";
import Welcome from "./components/Welcome.js";
import CypressStatus from "./components/CypressStatus.js";
import { Login } from "./components/Login.js";
import { WebviewMessages } from "../constants.js";
import {
  AuthServiceTag,
  AuthServiceLive,
  type Session,
} from "./services/auth-service.js";
import { VSCodeLive } from "./services/vscode.js";

interface VSCodeAPI {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
}

interface AppProps {
  vscode: VSCodeAPI;
}

interface CypressStatusData {
  overallStatus: "installed" | "not_installed" | "partial";
  packages: Array<{
    name: string;
    path: string;
    relativePath: string;
    hasCypressPackage: boolean;
    hasCypressConfig: boolean;
    isConfigured: boolean;
  }>;
  workspaceRoot: string;
}

interface MessageData {
  command: string;
  status?: CypressStatusData;
  error?: string;
  targetDirectory?: string;
  session?: Session;
}

// Store pending promises for message responses
const pendingPromises = new Map<
  string,
  { resolve: (value: MessageData) => void; reject: (error: Error) => void }
>();

const runtime = Runtime.defaultRuntime;
const authLayer = Layer.merge(VSCodeLive, AuthServiceLive);

// Create an Effect-based message system
const createMessageEffect = (
  vscode: VSCodeAPI,
  command: string,
  expectedResponseCommand: string,
): Effect.Effect<MessageData, Error> => {
  return Effect.tryPromise({
    try: () => {
      return new Promise<MessageData>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pendingPromises.delete(expectedResponseCommand);
          reject(new Error("Request timeout"));
        }, 10000);

        pendingPromises.set(expectedResponseCommand, {
          resolve: (value) => {
            clearTimeout(timeout);
            pendingPromises.delete(expectedResponseCommand);
            resolve(value);
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

// Helper to convert Effect to Promise for React Query
const runEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Runtime.runPromise(runtime)(effect);

const App: React.FC<AppProps> = ({ vscode }) => {
  const queryClient = useQueryClient();

  // Initialize auth service

  // Handle incoming messages from extension
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message = event.data as MessageData;

      // Check if there's a pending promise for this command
      const pending = pendingPromises.get(message.command);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message);
        }
      }

      // Update the query cache with the new status
      if (message.command === WebviewMessages.cypressStatus && message.status) {
        queryClient.setQueryData<CypressStatusData>(
          ["cypress-status"],
          message.status,
        );
      }

      // Update session cache on auth messages
      if (
        message.command === WebviewMessages.sessionStatus &&
        message.session
      ) {
        queryClient.setQueryData<Session>(["session"], message.session);
      }
      if (message.command === WebviewMessages.loginSuccess && message.session) {
        queryClient.setQueryData<Session>(["session"], message.session);
      }
      if (
        message.command === WebviewMessages.oauthCallback &&
        message.session
      ) {
        queryClient.setQueryData<Session>(["session"], message.session);
      }
    },
    [queryClient],
  );

  // Set up message listener to update query cache and resolve promises
  React.useEffect(() => {
    window.addEventListener("message", handleMessage);

    // Notify extension that webview is ready
    vscode.postMessage({
      command: WebviewMessages.ready,
    });

    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [vscode, handleMessage]);

  // Query for session
  const { data: session, isLoading: isSessionLoading } = useQuery<
    Session | undefined,
    Error
  >({
    queryKey: ["session"],
    queryFn: async () => {
      return runEffect(
        pipe(
          Effect.gen(function* () {
            const authService = yield* AuthServiceTag;
            return yield* authService.checkSession();
          }),
          Effect.provide(authLayer),
        ),
      );
    },
    refetchInterval: false,
    retry: false,
  });

  // Query for Cypress status (only when authenticated)
  const {
    data: cypressStatus,
    isLoading,
    error: queryError,
  } = useQuery<CypressStatusData, Error>({
    queryKey: ["cypress-status"],
    queryFn: async () => {
      return runEffect(
        pipe(
          createMessageEffect(
            vscode,
            WebviewMessages.refreshStatus,
            WebviewMessages.cypressStatus,
          ),
          Effect.flatMap((message) => {
            if (!message.status) {
              return Effect.fail(new Error("No status received"));
            }
            return Effect.succeed(message.status);
          }),
        ),
      );
    },
    refetchInterval: false,
    enabled: !!session, // Only fetch when authenticated
  });

  // Handle successful setup - refetch status
  const handleSetupSuccess = useCallback(() => {
    // Refetch status after successful setup
    // The file watcher should trigger an update, but we'll also manually refetch
    setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["cypress-status"] });
    }, 3000);
  }, [queryClient]);

  // Mutation for setting up Cypress
  const setupMutation = useMutation({
    mutationFn: async (targetDirectory?: string): Promise<void> => {
      return runEffect(
        pipe(
          Effect.sync(() => {
            vscode.postMessage({
              command: WebviewMessages.setupCypress,
              targetDirectory,
            });
          }),
          Effect.flatMap(() =>
            Effect.tryPromise({
              try: () => {
                return new Promise<void>((resolve, reject) => {
                  const timeout = setTimeout(() => {
                    window.removeEventListener("message", handler);
                    reject(new Error("Setup timeout"));
                  }, 60000); // 60 seconds for setup

                  const handler = (event: MessageEvent) => {
                    const message = event.data as MessageData;
                    if (message.command === WebviewMessages.setupError) {
                      clearTimeout(timeout);
                      window.removeEventListener("message", handler);
                      reject(new Error(message.error || "Setup failed"));
                    } else if (message.command === WebviewMessages.setupStart) {
                      // Setup started successfully
                      // The status will be refreshed automatically via file watcher
                      // Wait a bit then resolve - status update will come via query cache
                      setTimeout(() => {
                        clearTimeout(timeout);
                        window.removeEventListener("message", handler);
                        resolve();
                      }, 1000);
                    }
                  };

                  window.addEventListener("message", handler);
                });
              },
              catch: (error) =>
                error instanceof Error ? error : new Error(String(error)),
            }),
          ),
          Effect.map(() => undefined),
        ),
      );
    },
    onSuccess: handleSetupSuccess,
  });

  const handleSetup = (targetDirectory?: string) => {
    setupMutation.mutate(targetDirectory);
  };

  const handleLoginSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [queryClient]);

  const error = queryError?.message || setupMutation.error?.message;

  // Show login screen if not authenticated
  if (isSessionLoading) {
    return (
      <div className="w-full h-full overflow-auto bg-background text-foreground flex items-center justify-center">
        <Welcome />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="w-full h-full overflow-auto bg-background text-foreground">
        <Login layer={authLayer} onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // Show main content when authenticated
  return (
    <div className="w-full h-full overflow-auto bg-background text-foreground">
      {isLoading && !cypressStatus ? (
        <Welcome />
      ) : cypressStatus ? (
        <CypressStatus
          status={cypressStatus}
          onSetup={handleSetup}
          setupInProgress={
            setupMutation.isPending
              ? setupMutation.variables || undefined
              : undefined
          }
          error={error}
        />
      ) : (
        <Welcome />
      )}
    </div>
  );
};

export default App;
