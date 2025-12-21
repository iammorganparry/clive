import React from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { useRpc } from "../../../rpc/provider.js";
import type { IndexingStatus } from "../../../../services/indexing-status.js";

dayjs.extend(relativeTime);

const STATUS_COLORS: Record<IndexingStatus, string> = {
  idle: "bg-gray-500",
  in_progress: "bg-blue-500",
  complete: "bg-green-500",
  error: "bg-red-500",
};

const STATUS_LABELS: Record<IndexingStatus, string> = {
  idle: "Not Indexed",
  in_progress: "Indexing...",
  complete: "Complete",
  error: "Error",
};

const formatTimeAgo = (date: Date | null): string => {
  if (!date) return "Never";
  return dayjs(date).fromNow();
};

// Error message mapping for user-friendly display
const getErrorDisplay = (errorMessage: string | undefined) => {
  if (!errorMessage) return null;

  // Map backend error types to user-friendly messages
  if (errorMessage.includes("Authentication required")) {
    return {
      title: "Authentication Required",
      message: "Please log in to enable codebase indexing.",
      action: "Log In",
    };
  }
  if (
    errorMessage.includes("Invalid token") ||
    errorMessage.includes("expired")
  ) {
    return {
      title: "Session Expired",
      message: "Your session has expired. Please log in again.",
      action: "Log In",
    };
  }
  if (
    errorMessage.includes("Database") ||
    errorMessage.includes("Repository")
  ) {
    return {
      title: "Database Error",
      message: "Failed to access the index database. Try again later.",
      action: "Retry",
    };
  }
  // Default error display
  return {
    title: "Error",
    message: errorMessage,
    action: "Retry",
  };
};

export const IndexingStatusCard: React.FC = () => {
  const rpc = useRpc();
  const queryClient = useQueryClient();

  const { data, isLoading } = rpc.config.getIndexingStatus.useQuery();

  // Set up polling based on status
  React.useEffect(() => {
    if (!data || !data.status) return;

    const interval = data.status === "in_progress" ? 2000 : 30000;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: ["rpc", "config", "getIndexingStatus"],
      });
    }, interval);

    return () => clearInterval(timer);
  }, [data, queryClient]);

  const reindexMutation = rpc.config.triggerReindex.useMutation({
    onSuccess: () => {
      // Refetch status after triggering re-index
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["indexingStatus"] });
      }, 1000);
    },
  });

  if (isLoading && !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Codebase Index</CardTitle>
          <CardDescription>Semantic search index status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  const status = (data?.status ?? "idle") as IndexingStatus;
  const statusColor = STATUS_COLORS[status];
  const statusLabel = STATUS_LABELS[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codebase Index</CardTitle>
        <CardDescription>Semantic search index status</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`h-3 w-3 rounded-full ${statusColor} ${
                status === "in_progress" ? "animate-pulse" : ""
              }`}
            />
            <span className="text-sm font-medium">{statusLabel}</span>
          </div>
          {data?.fileCount !== undefined && (
            <span className="text-sm text-muted-foreground">
              {data.fileCount} file{data.fileCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {data?.repositoryName && (
          <div className="space-y-1 text-sm">
            <div>
              <span className="text-muted-foreground">Repository: </span>
              <span className="font-medium">{data.repositoryName}</span>
            </div>
            {data.repositoryPath && (
              <div>
                <span className="text-muted-foreground">Path: </span>
                <span className="font-mono text-xs">{data.repositoryPath}</span>
              </div>
            )}
            {data.lastIndexedAt && (
              <div>
                <span className="text-muted-foreground">Last indexed: </span>
                <span>{formatTimeAgo(data.lastIndexedAt)}</span>
              </div>
            )}
          </div>
        )}

        {data &&
          "errorMessage" in data &&
          data.errorMessage &&
          (() => {
            const errorDisplay = getErrorDisplay(data.errorMessage);
            if (!errorDisplay) return null;
            return (
              <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm">
                <p className="font-medium text-red-800 dark:text-red-200">
                  {errorDisplay.title}
                </p>
                <p className="text-red-700 dark:text-red-300 mt-1">
                  {errorDisplay.message}
                </p>
              </div>
            );
          })()}

        <Button
          onClick={() => reindexMutation.mutate()}
          disabled={status === "in_progress" || reindexMutation.isPending}
          variant="outline"
          className="w-full"
        >
          {status === "in_progress" || reindexMutation.isPending
            ? "Indexing..."
            : "Re-index Codebase"}
        </Button>
      </CardContent>
    </Card>
  );
};
