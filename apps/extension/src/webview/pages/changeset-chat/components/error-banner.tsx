import type React from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@clive/ui/button";
import type { ChangesetChatError } from "../machines/changeset-chat-machine.js";

interface ErrorBannerProps {
  error: ChangesetChatError;
  onRetry: () => void;
  onDismiss: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  onRetry,
  onDismiss,
}) => {
  return (
    <div className="mb-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-destructive">
            {error.message}
          </p>
          {/* Contextual help text for common errors */}
          {error.message.includes("Insufficient funds") ||
          error.message.includes("402") ? (
            <p className="text-xs text-muted-foreground mt-1">
              Please add credits to your account to continue using AI services.
            </p>
          ) : error.message.includes("Network") ||
            error.message.includes("timeout") ||
            error.message.includes("ECONNREFUSED") ? (
            <p className="text-xs text-muted-foreground mt-1">
              Network error detected. Please check your connection and try
              again.
            </p>
          ) : error.message.includes("401") ||
            error.message.includes("Unauthorized") ? (
            <p className="text-xs text-muted-foreground mt-1">
              Authentication error. Please log in again.
            </p>
          ) : null}
        </div>
        <div className="flex gap-1.5 shrink-0">
          {error.retryable && (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Retry
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      </div>
    </div>
  );
};
