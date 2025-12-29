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
import { useRpc } from "../../../rpc/provider.js";

export const BaseBranchForm: React.FC = () => {
  const queryClient = useQueryClient();
  const rpc = useRpc();
  const [baseBranch, setBaseBranch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const {
    data: branchData,
    isLoading,
    error: queryError,
    refetch: refetchBaseBranch,
  } = rpc.config.getBaseBranch.useQuery();

  const autoDetected = branchData?.autoDetected || "main";
  const userConfigured = branchData?.baseBranch || null;

  // Update input when data loads
  useEffect(() => {
    if (userConfigured) {
      setBaseBranch(userConfigured);
    } else {
      setBaseBranch(autoDetected);
    }
  }, [userConfigured, autoDetected]);

  const saveMutation = rpc.config.setBaseBranch.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        setError(data.error);
      } else {
        // Invalidate the query to refetch fresh data from the server
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getBaseBranch"],
        });
        setError(null);
      }
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to save base branch";
      setError(errorMessage);
    },
  });

  const handleSave = useCallback(() => {
    const trimmed = baseBranch.trim();
    if (!trimmed) {
      setError("Base branch cannot be empty");
      return;
    }
    setError(null);
    saveMutation.mutate({ branch: trimmed });
  }, [baseBranch, saveMutation]);

  const handleAutoDetect = useCallback(() => {
    setError(null);
    saveMutation.mutate({ branch: null });
  }, [saveMutation]);

  const isUsingAutoDetect = userConfigured === null;
  const hasChanged = userConfigured
    ? baseBranch.trim() !== userConfigured
    : baseBranch.trim() !== autoDetected;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Base Branch</CardTitle>
        <CardDescription>
          Configure the base branch for comparing changes. Auto-detect will use
          'main' or 'master' if available.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {queryError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm font-medium text-destructive">
              {queryError instanceof Error
                ? queryError.message
                : "Failed to load base branch"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchBaseBranch()}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <Input
              type="text"
              placeholder="e.g., main, master, develop"
              value={baseBranch}
              onChange={(e) => {
                setBaseBranch(e.target.value);
                setError(null);
              }}
              className="flex-1"
              disabled={isLoading || saveMutation.isPending}
            />
            <Button
              onClick={handleSave}
              disabled={
                !hasChanged ||
                !baseBranch.trim() ||
                isLoading ||
                saveMutation.isPending
              }
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {isUsingAutoDetect
                ? `Auto-detected: ${autoDetected}`
                : `Custom: ${userConfigured}`}
            </span>
            {!isUsingAutoDetect && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleAutoDetect}
                disabled={isLoading || saveMutation.isPending}
              >
                Reset to Auto-detect
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
