import { useState, useCallback, useEffect } from "react";
import type React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import { Input } from "@clive/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clive/ui/select";
import { Badge } from "@clive/ui/badge";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Key,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useRpc } from "../../../rpc/provider.js";

type AiProviderType = "anthropic" | "gateway" | "claude-cli";

interface ClaudeCliStatus {
  installed: boolean;
  path: string | null;
  authenticated: boolean;
  version: string | null;
  error?: string;
}

interface McpBridgeStatus {
  bridgeReady: boolean;
  starting: boolean;
  error: string | null;
  socketPath: string | null;
}

// API Key error handling types
type ErrorCategory = "validation" | "timeout" | "storage" | "unknown";

interface ApiKeyErrorInfo {
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

const createApiKeyErrorInfo = (errorMessage: string): ApiKeyErrorInfo => {
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

export const AiProviderForm: React.FC = () => {
  const queryClient = useQueryClient();
  const rpc = useRpc();
  const [provider, setProvider] = useState<AiProviderType>("gateway");
  const [error, setError] = useState<string | null>(null);

  // API Key state
  const [apiKey, setApiKey] = useState("");
  const [apiKeyError, setApiKeyError] = useState<ApiKeyErrorInfo | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Fetch current provider setting
  const {
    data: providerData,
    isLoading: isLoadingProvider,
    error: providerQueryError,
    refetch: refetchProvider,
  } = rpc.config.getAiProvider.useQuery();

  // Fetch Claude CLI status
  const {
    data: cliStatus,
    isLoading: isLoadingCli,
    refetch: refetchCliStatus,
  } = rpc.config.getClaudeCliStatus.useQuery();

  // Fetch MCP bridge status (only when Claude CLI is selected)
  const {
    data: mcpStatus,
    isLoading: isLoadingMcp,
    refetch: refetchMcpStatus,
  } = rpc.config.getMcpBridgeStatus.useQuery({
    enabled: provider === "claude-cli",
    refetchInterval: provider === "claude-cli" ? 3000 : false, // Poll every 3s when active
  });

  // Fetch API keys status
  const {
    data: apiKeysData,
    isLoading: isLoadingApiKeys,
    error: apiKeysQueryError,
    refetch: refetchApiKeys,
  } = rpc.config.getApiKeys.useQuery();

  // Update state when data loads
  useEffect(() => {
    if (providerData?.provider) {
      setProvider(providerData.provider as AiProviderType);
    }
  }, [providerData?.provider]);

  const saveMutation = rpc.config.setAiProvider.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        setError(data.error);
      } else {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getAiProvider"],
        });
        setError(null);
      }
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to save AI provider setting";
      setError(errorMessage);
    },
  });

  const authMutation = rpc.config.authenticateClaudeCli.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        refetchCliStatus();
      } else if ("error" in data && data.error) {
        setError(data.error);
      }
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error
          ? err.message
          : "Failed to authenticate with Claude CLI";
      setError(errorMessage);
    },
  });

  // API Key mutations
  const saveApiKeyMutation = rpc.config.saveApiKey.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        setApiKeyError(createApiKeyErrorInfo(data.error));
      } else {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getApiKeys"],
        });
        setApiKey("");
        setApiKeyError(null);
      }
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to save API key";
      setApiKeyError(createApiKeyErrorInfo(errorMessage));
    },
  });

  const deleteApiKeyMutation = rpc.config.deleteApiKey.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        setApiKeyError(createApiKeyErrorInfo(data.error));
      } else {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getApiKeys"],
        });
        setApiKey("");
        setApiKeyError(null);
        setShowDeleteConfirm(false);
      }
    },
    onError: (err) => {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete API key";
      setApiKeyError(createApiKeyErrorInfo(errorMessage));
      setShowDeleteConfirm(false);
    },
  });

  const handleProviderChange = useCallback(
    (value: AiProviderType) => {
      setProvider(value);
      setError(null);
      // Auto-save when provider changes
      saveMutation.mutate({ provider: value });
    },
    [saveMutation],
  );

  const handleAuthenticate = useCallback(() => {
    setError(null);
    authMutation.mutate();
  }, [authMutation]);

  const handleSaveApiKey = useCallback(() => {
    const validationError = validateApiKeyFormat(apiKey);
    if (validationError) {
      setApiKeyError(createApiKeyErrorInfo(validationError));
      return;
    }
    setApiKeyError(null);
    saveApiKeyMutation.mutate({ provider: "anthropic", key: apiKey.trim() });
  }, [apiKey, saveApiKeyMutation]);

  const handleDeleteApiKey = useCallback(() => {
    deleteApiKeyMutation.mutate({ provider: "anthropic" });
  }, [deleteApiKeyMutation]);

  const isLoading = isLoadingProvider || isLoadingCli || isLoadingApiKeys;
  const isSaving =
    saveMutation.isPending ||
    authMutation.isPending ||
    saveApiKeyMutation.isPending ||
    deleteApiKeyMutation.isPending;

  // Get Anthropic API key status
  const apiKeysStatus = apiKeysData?.statuses || [];
  const anthropicStatus = apiKeysStatus.find((s) => s.provider === "anthropic");

  const getProviderLabel = (type: AiProviderType): string => {
    switch (type) {
      case "anthropic":
        return "Anthropic API Key";
      case "gateway":
        return "Clive Gateway";
      case "claude-cli":
        return "Claude Code CLI";
    }
  };

  const getCliStatusBadge = (status: ClaudeCliStatus | undefined) => {
    if (!status) return null;

    if (!status.installed) {
      return <Badge variant="destructive">Not Installed</Badge>;
    }

    if (!status.authenticated) {
      return <Badge variant="secondary">Not Logged In</Badge>;
    }

    return <Badge variant="default">Ready</Badge>;
  };

  const typedCliStatus = cliStatus as ClaudeCliStatus | undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Provider</CardTitle>
        <CardDescription>
          Choose how to access Claude AI models. You can use your own API key,
          the Clive gateway, or your Claude subscription via the Claude Code
          CLI.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {providerQueryError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm font-medium text-destructive">
              {providerQueryError instanceof Error
                ? providerQueryError.message
                : "Failed to load AI provider setting"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchProvider()}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Select
            value={provider}
            onValueChange={handleProviderChange}
            disabled={isLoading || isSaving}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gateway">
                Clive Gateway (requires login)
              </SelectItem>
              <SelectItem value="anthropic">
                Anthropic API Key (pay per token)
              </SelectItem>
              <SelectItem value="claude-cli">
                Claude Code CLI (use your subscription)
              </SelectItem>
            </SelectContent>
          </Select>

          {error && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <div className="flex-1">
                <p className="text-sm text-destructive">{error}</p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setError(null)}
                  className="h-auto p-0 text-destructive hover:text-destructive/80"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground flex items-center gap-2">
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading provider status...</span>
              </>
            ) : (
              <>
                Current provider:{" "}
                <span className="font-medium">{getProviderLabel(provider)}</span>
              </>
            )}
          </div>
        </div>

        {/* Anthropic API Key section */}
        {provider === "anthropic" && (
          <>
            {/* Loading skeleton */}
            {isLoadingApiKeys && (
              <div className="p-3 bg-muted/50 rounded-md animate-pulse space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-32 bg-muted rounded" />
                </div>
                <div className="h-9 w-full bg-muted rounded" />
              </div>
            )}

            {/* Query error */}
            {apiKeysQueryError && (
              <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md space-y-2">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-destructive">
                      {apiKeysQueryError instanceof Error
                        ? apiKeysQueryError.message
                        : "Failed to load API key status"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Check your connection and try again.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchApiKeys()}
                  className="gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  Retry
                </Button>
              </div>
            )}

            {/* API key loaded */}
            {!isLoadingApiKeys && !apiKeysQueryError && (
              <div className="p-3 bg-muted/50 rounded-md space-y-3">
                <div className="flex items-center gap-2">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Anthropic API Key</span>
                  {anthropicStatus?.hasKey ? (
                    <Badge variant="default">Configured</Badge>
                  ) : (
                    <Badge variant="secondary">Not Set</Badge>
                  )}
                </div>

                {/* Has stored key - show masked key and delete option */}
                {anthropicStatus?.hasKey && anthropicStatus.maskedKey ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="font-mono text-muted-foreground">
                        {anthropicStatus.maskedKey}
                      </span>
                    </div>
                    <div className="flex gap-2 justify-end">
                      {showDeleteConfirm ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleDeleteApiKey}
                            disabled={deleteApiKeyMutation.isPending}
                            className="gap-1"
                          >
                            {deleteApiKeyMutation.isPending ? (
                              <>
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Deleting...
                              </>
                            ) : (
                              <>
                                <Trash2 className="h-3 w-3" />
                                Confirm Delete
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShowDeleteConfirm(false)}
                            disabled={deleteApiKeyMutation.isPending}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowDeleteConfirm(true)}
                          className="gap-1 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete Key
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* No stored key - show input */
                  <div className="space-y-3">
                    <Input
                      type="password"
                      placeholder="Enter your Anthropic API key (sk-ant-...)"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setApiKeyError(null);
                      }}
                      className="font-mono text-sm"
                      disabled={saveApiKeyMutation.isPending}
                    />

                    {/* API key error display */}
                    {apiKeyError && (
                      <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-destructive">
                              {apiKeyError.message}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {apiKeyError.hint}
                            </p>
                          </div>
                        </div>
                        {apiKeyError.canRetry && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setApiKeyError(null);
                              if (apiKey.trim()) {
                                handleSaveApiKey();
                              }
                            }}
                            className="gap-1"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Retry
                          </Button>
                        )}
                      </div>
                    )}

                    <Button
                      onClick={handleSaveApiKey}
                      disabled={
                        !apiKey.trim() || saveApiKeyMutation.isPending
                      }
                      className="w-full gap-2"
                    >
                      {saveApiKeyMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Key className="h-4 w-4" />
                          Save API Key
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Claude CLI status section */}
        {provider === "claude-cli" && (
          <>
            {/* Loading skeleton */}
            {isLoadingCli && (
              <div className="p-3 bg-muted/50 rounded-md animate-pulse space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-24 bg-muted rounded" />
                  <div className="h-5 w-20 bg-muted rounded-full" />
                </div>
                <div className="h-4 w-48 bg-muted rounded" />
              </div>
            )}

            {/* CLI status loaded */}
            {!isLoadingCli && typedCliStatus && (
              <div className="p-3 bg-muted/50 rounded-md space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Claude CLI Status:</span>
                  {getCliStatusBadge(typedCliStatus)}
                </div>

                {/* Not installed state */}
                {!typedCliStatus.installed && (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      <Download className="h-4 w-4 mt-0.5 text-muted-foreground" />
                      <div>
                        <p className="text-muted-foreground">
                          Claude Code CLI is not installed.
                        </p>
                        <a
                          href="https://claude.ai/download"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          Download Claude Code
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                    {/* Diagnostic info if detection failed with error */}
                    {typedCliStatus.error && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          Diagnostic info
                        </summary>
                        <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-auto">
                          {typedCliStatus.error}
                        </pre>
                      </details>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchCliStatus()}
                      className="gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Check again
                    </Button>
                  </div>
                )}

                {/* Installed but not authenticated */}
                {typedCliStatus.installed && !typedCliStatus.authenticated && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      You need to log in to your Claude account.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleAuthenticate}
                      disabled={authMutation.isPending}
                      className="gap-2"
                    >
                      {authMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Waiting for authorization...
                        </>
                      ) : (
                        "Login to Claude"
                      )}
                    </Button>
                    {/* Auth in progress message */}
                    {authMutation.isPending && (
                      <p className="text-xs text-muted-foreground">
                        A browser window should open. Complete the login there.
                        <br />
                        This may take up to 2 minutes.
                      </p>
                    )}
                  </div>
                )}

                {/* Ready state */}
                {typedCliStatus.installed && typedCliStatus.authenticated && (
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 text-green-600" />
                    <div>
                      <p>Claude Code is ready to use with your subscription.</p>
                      {typedCliStatus.version && (
                        <p className="text-xs mt-1">
                          Version: {typedCliStatus.version}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* MCP Bridge status - only show when CLI is ready */}
                {typedCliStatus.installed && typedCliStatus.authenticated && (
                  <div className="pt-3 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">MCP Bridge:</span>
                      {isLoadingMcp ? (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Checking...
                        </Badge>
                      ) : (mcpStatus as McpBridgeStatus | undefined)?.starting ? (
                        <Badge variant="secondary" className="gap-1">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Connecting...
                        </Badge>
                      ) : (mcpStatus as McpBridgeStatus | undefined)?.bridgeReady ? (
                        <Badge variant="default">Connected</Badge>
                      ) : (
                        <Badge variant="destructive">Disconnected</Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => refetchMcpStatus()}
                        className="h-6 w-6 p-0"
                        disabled={isLoadingMcp}
                      >
                        <RefreshCw className={`h-3 w-3 ${isLoadingMcp ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    {(mcpStatus as McpBridgeStatus | undefined)?.error && (
                      <p className="text-xs text-destructive mt-1">
                        {(mcpStatus as McpBridgeStatus | undefined)?.error}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
