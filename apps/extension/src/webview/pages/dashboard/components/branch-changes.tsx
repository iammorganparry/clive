import type React from "react";
import { useCallback, useMemo } from "react";
import { GitBranch, RefreshCw } from "lucide-react";
import FileTestRow from "./file-test-row.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";
import { useRpc } from "../../../rpc/provider.js";
import { useRouter } from "../../../router/router-context.js";
import { Routes } from "../../../router/routes.js";
import { Button } from "../../../../components/ui/button.js";

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




// Main Component
const BranchChanges: React.FC<BranchChangesProps> = (props) => {
  const rpc = useRpc();
  const { navigate } = useRouter();

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

  const { data: conversationMap } =
    rpc.conversations.hasConversationsBatch.useQuery({
      input: { sourceFiles: props.changes?.files.map((f) => f.path) ?? [] },
      enabled: (props.changes?.files.length ?? 0) > 0,
    });

  const handleGenerateTests = useCallback(() => {
    if (eligibleFilePaths.length === 0) return;
    const filesJson = JSON.stringify(eligibleFilePaths);
    navigate(Routes.changesetChat, {
      files: filesJson,
      branchName: props.changes?.branchName ?? "",
    });
  }, [eligibleFilePaths, props.changes?.branchName, navigate]);

  const handleRefresh = useCallback(async () => {
    if (props.onRefresh) {
      await props.onRefresh();
    }
  }, [props.onRefresh]);

  // Loading state
  if (props.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm font-medium">{branchName}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={props.isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${props.isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
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
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm font-medium">{branchName}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={props.isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${props.isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
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
        <div className="px-4 py-2 border-b">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              <span className="text-sm font-medium">{branchName}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={props.isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${props.isLoading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>
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
      {/* Secondary Header */}
      <div className="px-4 py-2 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            <span className="text-sm font-medium">{branchName}</span>
            <span className="text-xs text-muted-foreground">
              ({eligibleCount} of {totalFiles} file{totalFiles !== 1 ? "s" : ""})
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={props.isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 mr-1 ${props.isLoading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-auto">
        <div className="space-y-2 p-4">
          {props.changes.files.map((file) => (
            <FileTestRow
              key={file.path}
              file={file}
              chatContext={conversationMap?.[file.path]}
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
            Generate Tests for All Changes ({eligibleCount} file
            {eligibleCount !== 1 ? "s" : ""})
          </Button>
        </div>
      )}
    </div>
  );
};

export default BranchChanges;
