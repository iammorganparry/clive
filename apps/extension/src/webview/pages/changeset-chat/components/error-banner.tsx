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
    <div className="mb-4 p-4 bg-error-muted border border-destructive/50 rounded-lg">
      <div className="flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-destructive mb-1">
            {error.message}
          </p>
          {/* Contextual help text for common errors */}
          {error.message.includes("Insufficient funds") ||
          error.message.includes("402") ? (
            <p className="text-xs text-muted-foreground mb-3">
              Please add credits to your account to continue using AI services.
            </p>
          ) : error.message.includes("Network") ||
            error.message.includes("timeout") ||
            error.message.includes("ECONNREFUSED") ? (
            <p className="text-xs text-muted-foreground mb-3">
              Network error detected. Please check your connection and try
              again.
            </p>
          ) : error.message.includes("401") ||
            error.message.includes("Unauthorized") ? (
            <p className="text-xs text-muted-foreground mb-3">
              Authentication error. Please log in again.
            </p>
          ) : null}
          <div className="flex gap-2">
            {error.retryable && (
              <Button size="sm" variant="default" onClick={onRetry}>
                Retry
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={onDismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
