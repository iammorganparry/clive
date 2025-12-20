import { useState, useCallback, useEffect } from "react";
import type React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import { Input } from "@clive/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { WebviewMessages } from "../../../../constants.js";
import { logger } from "../../../services/logger.js";
import type { VSCodeAPI } from "../../../services/vscode.js";

interface ApiKeyFormProps {
  vscode: VSCodeAPI;
  pendingPromises: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  createMessagePromise: (
    vscode: VSCodeAPI,
    command: string,
    expectedResponseCommand: string,
  ) => Promise<unknown>;
}

interface ApiKeyStatus {
  provider: "anthropic";
  hasKey: boolean;
  maskedKey?: string;
}

interface MessageData {
  command: string;
  statuses?: ApiKeyStatus[];
  error?: string;
}

type ErrorCategory = "validation" | "timeout" | "storage" | "unknown";

interface ErrorInfo {
  category: ErrorCategory;
  message: string;
  hint: string;
  canRetry: boolean;
}

const ERROR_RECOVERY: Record<
  ErrorCategory,
  { hint: string; canRetry: boolean }
> = {
  timeout: {
    hint: "The request took too long. Check your connection and try again.",
    canRetry: true,
  },
  storage: {
    hint: "Unable to access secure storage. Try restarting VS Code.",
    canRetry: true,
  },
  validation: {
    hint: "Check that your API key is correct and try again.",
    canRetry: false,
  },
  unknown: {
    hint: "An unexpected error occurred. Please try again.",
    canRetry: true,
  },
};

const categorizeError = (errorMessage: string): ErrorCategory => {
  const lowerMessage = errorMessage.toLowerCase();
  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return "timeout";
  }
  if (
    lowerMessage.includes("storage") ||
    lowerMessage.includes("secret") ||
    lowerMessage.includes("access")
  ) {
    return "storage";
  }
  if (
    lowerMessage.includes("invalid") ||
    lowerMessage.includes("format") ||
    lowerMessage.includes("prefix") ||
    lowerMessage.includes("empty") ||
    lowerMessage.includes("too short")
  ) {
    return "validation";
  }
  return "unknown";
};

const createErrorInfo = (errorMessage: string): ErrorInfo => {
  const category = categorizeError(errorMessage);
  const recovery = ERROR_RECOVERY[category];
  return {
    category,
    message: errorMessage,
    hint: recovery.hint,
    canRetry: recovery.canRetry,
  };
};

const validateApiKeyFormat = (key: string): string | null => {
  const trimmed = key.trim();
  if (!trimmed) {
    return "API key cannot be empty";
  }
  if (!trimmed.startsWith("sk-ant-")) {
    return 'API key must start with "sk-ant-"';
  }
  if (trimmed.length < 20) {
    return "API key must be at least 20 characters long";
  }
  const keyBody = trimmed.slice(7);
  if (!/^[a-zA-Z0-9_-]+$/.test(keyBody)) {
    return "API key contains invalid characters. Only letters, numbers, hyphens, and underscores are allowed.";
  }
  return null;
};

interface ErrorDisplayProps {
  error: ErrorInfo;
  onRetry?: () => void;
}

const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, onRetry }) => {
  return (
    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md space-y-2">
      <p className="text-sm font-medium text-destructive">{error.message}</p>
      <p className="text-sm text-muted-foreground">{error.hint}</p>
      {error.canRetry && onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Retry
        </Button>
      )}
    </div>
  );
};

export const ApiKeyForm: React.FC<ApiKeyFormProps> = ({
  vscode,
  pendingPromises,
  createMessagePromise,
}) => {
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message = event.data as MessageData;
      logger.message.receive(message.command, message);

      const pending = pendingPromises.get(message.command);
      if (pending) {
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message);
        }
      }

      if (
        message.command === WebviewMessages.apiKeysStatus &&
        message.statuses !== undefined
      ) {
        queryClient.setQueryData<ApiKeyStatus[]>(
          ["api-keys-status"],
          message.statuses,
        );
      }
    },
    [queryClient, pendingPromises],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
    };
  }, [handleMessage]);

  const {
    data: apiKeysStatus,
    isLoading,
    error: queryError,
    refetch: refetchApiKeys,
  } = useQuery<ApiKeyStatus[], Error>({
    queryKey: ["api-keys-status"],
    queryFn: async () => {
      logger.query.start("api-keys-status");
      try {
        const message = (await createMessagePromise(
          vscode,
          WebviewMessages.getApiKeys,
          WebviewMessages.apiKeysStatus,
        )) as MessageData;

        if (!message.statuses) {
          throw new Error("No status received");
        }

        logger.query.success("api-keys-status", message.statuses);
        return message.statuses;
      } catch (error) {
        logger.query.error("api-keys-status", error);
        throw error;
      }
    },
    refetchInterval: false,
  });

  const anthropicStatus = apiKeysStatus?.find(
    (s) => s.provider === "anthropic",
  );

  const saveMutation = useMutation({
    mutationFn: async (key: string) => {
      logger.debug("Saving API key");
      try {
        vscode.postMessage({
          command: WebviewMessages.saveApiKey,
          provider: "anthropic",
          key,
        });

        return new Promise<MessageData>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Request timeout"));
          }, 10000);

          const checkResponse = (event: MessageEvent) => {
            const msg = event.data as MessageData;
            if (msg.command === WebviewMessages.apiKeysStatus) {
              clearTimeout(timeout);
              window.removeEventListener("message", checkResponse);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(msg);
              }
            }
          };

          window.addEventListener("message", checkResponse);
        });
      } catch (error) {
        logger.error("Failed to save API key", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys-status"] });
      setApiKey("");
      setError(null);
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save API key";
      setError(createErrorInfo(errorMessage));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      logger.debug("Deleting API key");
      try {
        vscode.postMessage({
          command: WebviewMessages.deleteApiKey,
          provider: "anthropic",
        });

        return new Promise<MessageData>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Request timeout"));
          }, 10000);

          const checkResponse = (event: MessageEvent) => {
            const msg = event.data as MessageData;
            if (msg.command === WebviewMessages.apiKeysStatus) {
              clearTimeout(timeout);
              window.removeEventListener("message", checkResponse);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(msg);
              }
            }
          };

          window.addEventListener("message", checkResponse);
        });
      } catch (error) {
        logger.error("Failed to delete API key", error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys-status"] });
      setApiKey("");
      setError(null);
      setShowDeleteConfirm(false);
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete API key";
      setError(createErrorInfo(errorMessage));
      setShowDeleteConfirm(false);
    },
  });

  const handleSave = useCallback(() => {
    const validationError = validateApiKeyFormat(apiKey);
    if (validationError) {
      setError(createErrorInfo(validationError));
      return;
    }
    setError(null);
    saveMutation.mutate(apiKey.trim());
  }, [apiKey, saveMutation]);

  const handleDelete = useCallback(() => {
    deleteMutation.mutate();
  }, [deleteMutation]);

  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Anthropic API Key</CardTitle>
        <CardDescription>
          Enter your Anthropic API key to use Claude models. Your key is stored
          securely and encrypted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {queryError && (
          <ErrorDisplay
            error={createErrorInfo(
              queryError instanceof Error
                ? queryError.message
                : "Failed to load API keys",
            )}
            onRetry={() => refetchApiKeys()}
          />
        )}

        {anthropicStatus?.hasKey && anthropicStatus.maskedKey ? (
          <div className="space-y-4">
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-mono text-muted-foreground">
                Current key: {anthropicStatus.maskedKey}
              </p>
            </div>
            <div className="flex gap-2 justify-end w-full items-center">
              {showDeleteConfirm ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDelete}
                    disabled={isLoading || deleteMutation.isPending}
                  >
                    {deleteMutation.isPending
                      ? "Deleting..."
                      : "Confirm Delete"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isLoading || deleteMutation.isPending}
                  >
                    Cancel
                  </Button>
                </>
              ) : (
                <Button
                  variant="destructive"
                  onClick={handleDeleteClick}
                  disabled={isLoading || deleteMutation.isPending}
                >
                  Delete
                </Button>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Enter your Anthropic API key (sk-ant-...)"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError(null);
                }}
                className="font-mono text-sm"
                disabled={isLoading || saveMutation.isPending}
              />
              {error && (
                <ErrorDisplay
                  error={error}
                  onRetry={
                    error.canRetry
                      ? () => {
                          setError(null);
                          if (apiKey.trim()) {
                            handleSave();
                          } else {
                            refetchApiKeys();
                          }
                        }
                      : undefined
                  }
                />
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={!apiKey.trim() || isLoading || saveMutation.isPending}
                className="flex-1"
              >
                {saveMutation.isPending ? "Saving..." : "Save API Key"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
