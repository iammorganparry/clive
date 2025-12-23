import { useCallback } from "react";
import type React from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { useMachine } from "@xstate/react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { AlertCircle, Brain, Loader2, X } from "lucide-react";
import { useRpc } from "../../../rpc/provider.js";
import { createRequest } from "../../../rpc/hooks.js";
import { getVSCodeAPI } from "../../../services/vscode.js";
import {
  knowledgeBaseMachine,
  type ErrorType,
} from "../machines/knowledge-base-machine.js";
import type { KnowledgeBaseStatus } from "../../../../services/knowledge-base-types.js";

dayjs.extend(relativeTime);

const formatTimeAgo = (date: Date | null): string => {
  if (!date) return "Never";
  return dayjs(date).fromNow();
};

const CATEGORY_LABELS: Record<string, string> = {
  framework: "Framework",
  patterns: "Patterns",
  mocks: "Mocks",
  fixtures: "Fixtures",
  selectors: "Selectors",
  routes: "Routes",
  assertions: "Assertions",
  hooks: "Hooks",
  utilities: "Utilities",
  coverage: "Coverage",
  gaps: "Gaps",
  improvements: "Improvements",
};

/**
 * Get user-friendly error display information
 */
function getErrorDisplay(
  errorType: ErrorType | null,
  errorMessage: string | null,
): { title: string; message: string; action: string } | null {
  if (!errorType || !errorMessage) return null;

  switch (errorType) {
    case "auth_required":
      return {
        title: "Authentication Required",
        message: "Please log in to generate the knowledge base.",
        action: "Log In",
      };
    case "session_expired":
      return {
        title: "Session Expired",
        message: "Your session has expired. Please log in again.",
        action: "Log In",
      };
    case "network_error":
      return {
        title: "Network Error",
        message:
          "Failed to connect to the server. Please check your connection.",
        action: "Retry",
      };
    case "generation_failed":
      return {
        title: "Generation Failed",
        message: errorMessage,
        action: "Retry",
      };
    default:
      return {
        title: "Error",
        message: errorMessage,
        action: "Retry",
      };
  }
}

export const KnowledgeBaseCard: React.FC = () => {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const vscode = getVSCodeAPI();

  // Get mutation hook for regeneration
  const regenerateMutation = rpc.knowledgeBase.regenerate.useMutation();

  // Create stable callback functions for the machine
  const fetchStatus = useCallback(async (): Promise<KnowledgeBaseStatus> => {
    return await queryClient.fetchQuery<KnowledgeBaseStatus>({
      queryKey: ["rpc", "knowledgeBase", "getStatus"],
      queryFn: async () => {
        const request = createRequest(
          vscode,
          ["knowledgeBase", "getStatus"],
          "query",
        );
        return (await request()) as KnowledgeBaseStatus;
      },
    });
  }, [queryClient, vscode]);

  const regenerate = useCallback(async () => {
    return await regenerateMutation.mutateAsync();
  }, [regenerateMutation]);

  // Use XState machine for state management
  // Machine automatically starts in "loading" state and fetches status
  const [state, send] = useMachine(knowledgeBaseMachine, {
    input: { fetchStatus, regenerate },
  });

  const status = state.context.status;
  const errorType = state.context.errorType;
  const errorMessage = state.context.errorMessage;
  const hasKnowledge = status?.hasKnowledge ?? false;
  const categories = status?.categories ?? [];
  const entryCount = status?.entryCount ?? 0;
  const lastUpdated = status?.lastUpdatedAt
    ? new Date(status.lastUpdatedAt)
    : null;

  const isGenerating =
    state.matches("generating") ||
    state.matches("polling") ||
    state.matches("checkingGenerationStatus");
  const isLoading = state.matches("loading");
  const isError = state.matches("error");

  const errorDisplay = getErrorDisplay(errorType, errorMessage);

  const handleRegenerate = () => {
    send({ type: "REGENERATE" });
  };

  const handleRetry = () => {
    send({ type: "RETRY" });
  };

  const handleDismiss = () => {
    send({ type: "DISMISS" });
  };

  const handleCancel = () => {
    send({ type: "CANCEL" });
  };

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            Testing Knowledge Base
          </CardTitle>
          <CardDescription>
            AI-analyzed patterns from your test files
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading...
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5" />
          Testing Knowledge Base
        </CardTitle>
        <CardDescription>
          AI-analyzed patterns from your test files
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error display */}
        {isError && errorDisplay && (
          <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                  <p className="font-medium text-red-800 dark:text-red-200">
                    {errorDisplay.title}
                  </p>
                </div>
                <p className="text-red-700 dark:text-red-300 mt-1">
                  {errorDisplay.message}
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                aria-label="Dismiss error"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={handleRetry}
                variant="outline"
                size="sm"
                className="text-red-700 dark:text-red-300 border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900"
              >
                {errorDisplay.action}
              </Button>
            </div>
          </div>
        )}

        {/* Status indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${
                isGenerating
                  ? "bg-blue-500 animate-pulse"
                  : hasKnowledge
                    ? "bg-green-500"
                    : "bg-gray-500"
              }`}
            />
            <span className="text-sm font-medium">
              {isGenerating
                ? "Generating..."
                : hasKnowledge
                  ? "Generated"
                  : "Not Generated"}
            </span>
          </div>
          {entryCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {entryCount} entr{entryCount !== 1 ? "ies" : "y"}
            </span>
          )}
        </div>

        {/* Category breakdown */}
        {categories.length > 0 && (
          <div className="space-y-2">
            <div className="text-sm font-medium">Categories:</div>
            <div className="flex flex-wrap gap-2">
              {categories.map((category) => (
                <span
                  key={category}
                  className="px-2 py-1 text-xs bg-muted rounded-md"
                >
                  {CATEGORY_LABELS[category] || category}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Last updated */}
        {lastUpdated && (
          <div className="text-sm text-muted-foreground">
            Last updated: {formatTimeAgo(lastUpdated)}
          </div>
        )}

        {/* Action buttons */}
        {isGenerating ? (
          <div className="space-y-2">
            <Button
              onClick={handleCancel}
              disabled={false}
              variant="destructive"
              className="w-full"
            >
              Cancel Generation
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing repository and building knowledge base...
            </div>
          </div>
        ) : (
          <Button
            onClick={handleRegenerate}
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            {hasKnowledge
              ? "Regenerate Knowledge Base"
              : "Generate Knowledge Base"}
          </Button>
        )}

        {/* Info note */}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          The knowledge base analyzes your test files to understand testing
          patterns, frameworks, and conventions. This helps generate tests that
          match your codebase style.
        </div>
      </CardContent>
    </Card>
  );
};
