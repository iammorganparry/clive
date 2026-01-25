import { Button } from "@clive/ui/button";
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
import { useQueryClient } from "@tanstack/react-query";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useRpc } from "../../../rpc/provider.js";

export const TerminalCommandApprovalForm: React.FC = () => {
  const queryClient = useQueryClient();
  const rpc = useRpc();
  const [approval, setApproval] = useState<"always" | "auto">("always");
  const [error, setError] = useState<string | null>(null);

  const {
    data: approvalData,
    isLoading,
    error: queryError,
    refetch: refetchApproval,
  } = rpc.config.getTerminalCommandApproval.useQuery();

  // Update state when data loads
  useEffect(() => {
    if (approvalData?.approval) {
      setApproval(approvalData.approval);
    }
  }, [approvalData?.approval]);

  const saveMutation = rpc.config.setTerminalCommandApproval.useMutation({
    onSuccess: (data) => {
      if ("error" in data && data.error) {
        setError(data.error);
      } else {
        // Invalidate the query to refetch fresh data from the server
        queryClient.invalidateQueries({
          queryKey: ["rpc", "config", "getTerminalCommandApproval"],
        });
        setError(null);
      }
    },
    onError: (error) => {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to save terminal command approval setting";
      setError(errorMessage);
    },
  });

  const handleSave = useCallback(() => {
    setError(null);
    saveMutation.mutate({ approval });
  }, [approval, saveMutation]);

  const hasChanged =
    approvalData?.approval && approval !== approvalData.approval;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terminal Command Approval</CardTitle>
        <CardDescription>
          Control whether terminal commands require explicit approval before
          execution. When set to "Always ask", you'll be prompted to approve
          each command. When set to "Auto-approve", commands will execute
          automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {queryError && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm font-medium text-destructive">
              {queryError instanceof Error
                ? queryError.message
                : "Failed to load terminal command approval setting"}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchApproval()}
              className="mt-2"
            >
              Retry
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex gap-2">
            <Select
              value={approval}
              onValueChange={(value: "always" | "auto") => {
                setApproval(value);
                setError(null);
              }}
              disabled={isLoading || saveMutation.isPending}
            >
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always ask</SelectItem>
                <SelectItem value="auto">Auto-approve</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={handleSave}
              disabled={!hasChanged || isLoading || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="text-sm text-muted-foreground">
            <span>
              Current setting:{" "}
              <span className="font-medium">
                {approval === "always" ? "Always ask" : "Auto-approve"}
              </span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
