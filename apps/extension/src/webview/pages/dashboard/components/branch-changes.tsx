import { Button } from "@clive/ui/button";
import { cn } from "@clive/ui/lib/utils";
import { GitBranch, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useMemo } from "react";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";
import { useComparisonMode } from "../../../contexts/comparison-mode-context.js";
import { useRouter } from "../../../router/router-context.js";
import { Routes } from "../../../router/routes.js";
import { useRpc } from "../../../rpc/provider.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import FileTestRow from "./file-test-row.js";

export interface EligibleFile {
  path: string;
  relativePath: string;
  status: "M" | "A" | "D" | "R";
  isEligible: boolean;
  reason?: string;
}

export interface BranchChangesData {
  branchName: string;
  baseBranch: string;
  files: EligibleFile[];
  workspaceRoot: string;
}

export interface FileGenerationState {
  status: "idle" | "generating" | "completed" | "error";
  statusMessage: string;
  logs: string[];
  error?: string;
  testFilePath?: string;
}

interface BranchChangesProps {
  changes: BranchChangesData | null;
  isLoading: boolean;
  error?: string;
  vscode: VSCodeAPI;
  onViewTest?: (testFilePath: string) => void;
  onPreviewDiff?: (test: ProposedTest) => void;
  onRefresh?: () => Promise<void>;
}

interface BranchHeaderProps {
  branchName: string;
  isLoading: boolean;
  onRefresh: () => void;
  fileCount?: {
    eligible: number;
    total: number;
  };
}

const BranchHeader: React.FC<BranchHeaderProps> = ({
  branchName,
  isLoading,
  onRefresh,
  fileCount,
}) => {
  const { mode, setMode } = useComparisonMode();

  return (
    <div className="px-4 py-2 border-b">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4" />
          <span className="text-sm font-medium">{branchName}</span>
          {fileCount && (
            <span className="text-xs text-muted-foreground">
              ({fileCount.eligible} of {fileCount.total} file
              {fileCount.total !== 1 ? "s" : ""})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setMode("branch")}
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors",
                mode === "branch"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              All Changes
            </button>
            <button
              type="button"
              onClick={() => setMode("uncommitted")}
              className={cn(
                "px-1.5 py-0.5 text-[10px] font-medium rounded transition-colors",
                mode === "uncommitted"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Uncommitted
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground w-4 h-4"
            onClick={onRefresh}
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-2 w-2 mr-1 ${isLoading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>
    </div>
  );
};

// Main Component
const BranchChanges: React.FC<BranchChangesProps> = (props) => {
  const rpc = useRpc();
  const { navigate } = useRouter();
  const { mode } = useComparisonMode();

  // Get branch name from changes or use fallback
  const branchName =
    props.changes?.branchName ?? "Unknown Branch";

  // Calculate eligible file count
  const eligibleFiles = useMemo(() => {
    return props.changes?.files.filter((f) => f.isEligible) ?? [];
  }, [props.changes?.files]);

  const totalFiles = props.changes?.files.length ?? 0;
  const eligibleCount = eligibleFiles.length;

  // Get file paths for eligible files only (for generating tests)
  const eligibleFilePaths = useMemo(
    () => eligibleFiles.map((f) => f.path),
    [eligibleFiles],
  );

  // Get current commit hash for uncommitted conversations
  const { data: currentCommit } = rpc.status.currentCommit.useQuery();
  const commitHash = currentCommit?.commitHash;

  // Check if conversation exists for current mode
  const { data: branchConversation } =
    rpc.conversations.hasBranchConversation.useQuery({
      input: {
        branchName: props.changes?.branchName ?? "",
        baseBranch: props.changes?.baseBranch ?? "main",
        conversationType: mode === "branch" ? "branch" : "uncommitted",
        commitHash: mode === "uncommitted" ? commitHash : undefined,
      },
      enabled:
        !!props.changes?.branchName &&
        (mode === "branch" || !!commitHash),
    });

  const handleGenerateTests = useCallback(() => {
    if (eligibleFilePaths.length === 0) return;
    const filesJson = JSON.stringify(eligibleFilePaths);
    const params: Record<string, string> = {
      files: filesJson,
      branchName: props.changes?.branchName ?? "",
      mode,
    };
    if (mode === "uncommitted" && commitHash) {
      params.commitHash = commitHash;
    }
    navigate(Routes.changesetChat, params);
  }, [
    eligibleFilePaths,
    props.changes?.branchName,
    navigate,
    mode,
    commitHash,
  ]);

  const handleRefresh = useCallback(async () => {
    if (props.onRefresh) {
      await props.onRefresh();
    }
  }, [props.onRefresh]);

  // Loading state
  if (props.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <BranchHeader
          branchName={branchName}
          isLoading={props.isLoading}
          onRefresh={handleRefresh}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">
            Loading changed files...
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (props.error) {
    return (
      <div className="flex flex-col h-full">
        <BranchHeader
          branchName={branchName}
          isLoading={props.isLoading}
          onRefresh={handleRefresh}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-destructive">{props.error}</div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!props.changes || totalFiles === 0) {
    return (
      <div className="flex flex-col h-full">
        <BranchHeader
          branchName={branchName}
          isLoading={props.isLoading}
          onRefresh={handleRefresh}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">
            No files changed on this branch
          </div>
        </div>
      </div>
    );
  }

  // Main content
  return (
    <div className="flex flex-col h-full">
      <BranchHeader
        branchName={branchName}
        isLoading={props.isLoading}
        onRefresh={handleRefresh}
        fileCount={{ eligible: eligibleCount, total: totalFiles }}
      />

      {/* File List */}
      <div className="flex-1 overflow-auto">
        <div className="space-y-2 p-4">
          {props.changes.files.map((file) => (
            <FileTestRow
              key={file.path}
              file={file}
              onViewTest={props.onViewTest}
              onPreviewDiff={
                props.onPreviewDiff
                  ? (test) => props.onPreviewDiff?.(test as ProposedTest)
                  : undefined
              }
            />
          ))}
        </div>
      </div>

      {/* Generate Tests Button */}
      {eligibleCount > 0 && (
        <div className="p-4 border-t">
          <Button onClick={handleGenerateTests} className="w-full">
            {branchConversation?.exists ? "Continue Conversation" : "Generate Tests"} for {mode === "branch" ? "All Changes" : "Uncommitted Changes"} ({eligibleCount} file
            {eligibleCount !== 1 ? "s" : ""})
          </Button>
        </div>
      )}
    </div>
  );
};

export default BranchChanges;
