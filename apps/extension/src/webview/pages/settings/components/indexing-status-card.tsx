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
import { Switch } from "@clive/ui/switch";
import { Label } from "@clive/ui/label";
import { Shield } from "lucide-react";
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

  // Fetch indexing preference (enabled state)
  const { data: prefData, isLoading: prefLoading } =
    rpc.config.getIndexingPreference.useQuery();
  const isEnabled = prefData?.enabled ?? false;

  // Mutation to toggle indexing
  const setEnabledMutation = rpc.config.setIndexingEnabled.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["rpc", "config", "getIndexingPreference"],
      });
      queryClient.invalidateQueries({
        queryKey: ["rpc", "config", "getIndexingStatus"],
      });
    },
  });

  const handleToggle = (checked: boolean) => {
    setEnabledMutation.mutate({ enabled: checked });
  };

  const { data, isLoading } = rpc.config.getIndexingStatus.useQuery();

  // Set up polling based on status (only when enabled)
  React.useEffect(() => {
    if (!isEnabled || !data || !data.status) return;

    const interval = data.status === "in_progress" ? 2000 : 30000;
    const timer = setInterval(() => {
      queryClient.invalidateQueries({
        queryKey: ["rpc", "config", "getIndexingStatus"],
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isEnabled, data, queryClient]);

  const reindexMutation = rpc.config.triggerReindex.useMutation({
    onSuccess: () => {
      // Refetch status after triggering re-index
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getIndexingStatus"],
        });
      }, 1000);
    },
  });

  const cancelMutation = rpc.config.cancelIndexing.useMutation({
    onSuccess: () => {
      // Refetch status after cancelling
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getIndexingStatus"],
        });
      }, 500);
    },
    onError: () => {
      // Refetch status even if cancel failed (status might have changed)
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getIndexingStatus"],
        });
      }, 500);
    },
  });

  if (prefLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Codebase Index</CardTitle>
          <CardDescription>Smart code understanding</CardDescription>
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

  // Use progress.totalFiles when indexing, otherwise use fileCount from database
  const displayFileCount =
    status === "in_progress" &&
    data &&
    "progress" in data &&
    data.progress?.totalFiles !== undefined
      ? data.progress.totalFiles
      : data?.fileCount;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Codebase Index</CardTitle>
        <CardDescription>Smart code understanding</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="indexing-toggle" className="text-sm font-medium">
              Enable Indexing
            </Label>
            <p className="text-xs text-muted-foreground">
              Allow Clive to index your codebase for smarter assistance
            </p>
          </div>
          <Switch
            id="indexing-toggle"
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={setEnabledMutation.isPending}
          />
        </div>

        {/* Privacy note */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
          <Shield className="w-3 h-3 mt-0.5 flex-shrink-0 text-success" />
          <span>
            Your code stays private. Only semantic embeddings are stored
            securely.
          </span>
        </div>

        {/* Status section - only show when enabled */}
        {isEnabled && (
          <>
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-3 w-3 rounded-full ${statusColor} ${
                      status === "in_progress" ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="text-sm font-medium">{statusLabel}</span>
                </div>
                {displayFileCount !== undefined && (
                  <span className="text-sm text-muted-foreground">
                    {displayFileCount} file{displayFileCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {/* Progress indicator when indexing */}
              {status === "in_progress" &&
                data &&
                "progress" in data &&
                data.progress && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        Indexing {data.progress.filesIndexed} of{" "}
                        {data.progress.totalFiles} files
                      </span>
                      <span>
                        {data.progress.totalFiles > 0
                          ? Math.round(
                              (data.progress.filesIndexed /
                                data.progress.totalFiles) *
                                100,
                            )
                          : 0}
                        %
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-blue-500 transition-all duration-300"
                        style={{
                          width: `${
                            data.progress.totalFiles > 0
                              ? (
                                  data.progress.filesIndexed /
                                    data.progress.totalFiles
                                ) * 100
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
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
                    <span className="font-mono text-xs">
                      {data.repositoryPath}
                    </span>
                  </div>
                )}
                {data.lastIndexedAt && (
                  <div>
                    <span className="text-muted-foreground">
                      Last indexed:{" "}
                    </span>
                    <span>{formatTimeAgo(data.lastIndexedAt)}</span>
                  </div>
                )}
              </div>
            )}

            {data &&
              "errorMessage" in data &&
              data.errorMessage &&
              getErrorDisplay(data.errorMessage) && (
                <div className="rounded-md bg-error-muted p-3 text-sm">
                  <p className="font-medium text-destructive">
                    {getErrorDisplay(data.errorMessage)?.title}
                  </p>
                  <p className="text-destructive mt-1">
                    {getErrorDisplay(data.errorMessage)?.message}
                  </p>
                </div>
              )}

            {status === "in_progress" ? (
              <Button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                variant="destructive"
                className="w-full"
              >
                {cancelMutation.isPending ? "Cancelling..." : "Cancel Indexing"}
              </Button>
            ) : (
              <Button
                onClick={() => reindexMutation.mutate()}
                disabled={reindexMutation.isPending || isLoading}
                variant="outline"
                className="w-full"
              >
                {reindexMutation.isPending
                  ? "Starting..."
                  : "Re-index Codebase"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
