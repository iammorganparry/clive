import type React from "react";
import { useState, useCallback, useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import { GitBranch, ChevronDown, ChevronRight } from "lucide-react";
import FileTestRow from "./file-test-row.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import type { ProposedTest } from "../../../../services/ai-agent/types.js";
import { useRpc } from "../../../rpc/provider.js";

export interface EligibleFile {
  path: string;
  relativePath: string;
  status: "M" | "A" | "D" | "R";
  isEligible: boolean;
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
}

interface BranchHeaderProps {
  branchName: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const BranchHeader: React.FC<BranchHeaderProps> = ({
  branchName,
  isExpanded,
  onToggle,
}) => (
  <CardHeader>
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full text-left hover:opacity-80 transition-opacity"
    >
      {isExpanded ? (
        <ChevronDown className="h-4 w-4" />
      ) : (
        <ChevronRight className="h-4 w-4" />
      )}
      <CardTitle className="flex items-center gap-2">
        <GitBranch className="h-4 w-4" />
        BRANCH
      </CardTitle>
    </button>
    <CardDescription className="flex items-center gap-2 ml-6">
      <span>{branchName}</span>
    </CardDescription>
  </CardHeader>
);

interface BranchContentProps {
  files: EligibleFile[];
  onViewTest?: (testFilePath: string) => void;
  onPreviewDiff?: (test: ProposedTest) => void;
}

const BranchContent: React.FC<BranchContentProps> = ({
  files,
  onViewTest,
  onPreviewDiff,
}) => {
  const rpc = useRpc();
  const filePaths = useMemo(() => files.map((f) => f.path), [files]);

  const { data: conversationMap } =
    rpc.conversations.hasConversationsBatch.useQuery({
      input: { sourceFiles: filePaths },
      enabled: filePaths.length > 0,
    });

  return (
    <CardContent className="space-y-2">
      <div className="space-y-2">
        {files.map((file) => (
          <FileTestRow
            key={file.path}
            file={file}
            chatContext={conversationMap?.[file.path]}
            onViewTest={onViewTest}
            onPreviewDiff={onPreviewDiff}
          />
        ))}
      </div>
    </CardContent>
  );
};

// Card State Components
interface BranchChangesCardProps {
  description: string;
  isError?: boolean;
}

const BranchChangesCard: React.FC<BranchChangesCardProps> = ({
  description,
  isError = false,
}) => (
  <Card>
    <CardHeader>
      <CardTitle>Branch Changes</CardTitle>
      <CardDescription className={isError ? "text-destructive" : ""}>
        {description}
      </CardDescription>
    </CardHeader>
  </Card>
);

// Main Component
const BranchChanges: React.FC<BranchChangesProps> = (props) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (props.isLoading) {
    return <BranchChangesCard description="Loading changed files..." />;
  }

  if (props.error) {
    return <BranchChangesCard description={props.error} isError />;
  }

  if (!props.changes || props.changes.files.length === 0) {
    return (
      <BranchChangesCard description="No eligible files changed on this branch" />
    );
  }

  return (
    <Card>
      <BranchHeader
        branchName={props.changes.branchName}
        isExpanded={isExpanded}
        onToggle={handleToggle}
      />
      {isExpanded && (
        <BranchContent
          files={props.changes.files}
          onViewTest={props.onViewTest}
          onPreviewDiff={props.onPreviewDiff}
        />
      )}
    </Card>
  );
};

export default BranchChanges;
