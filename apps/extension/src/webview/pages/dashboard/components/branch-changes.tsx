import type React from "react";
import { useState, useCallback } from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import { Task, TaskTrigger, TaskContent, TaskItem } from "@clive/ui/task";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
  Loader2,
  AlertCircle,
  XCircle,
  FileSearch,
  FileOutput,
  Settings,
  Play,
  CheckCircle,
  Search,
  Circle,
  Eye,
} from "lucide-react";
import {
  truncateMiddle,
  truncateLogMessage,
} from "../../../utils/path-utils.js";

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
  fileStates: Map<string, FileGenerationState>;
  onCreateTest: (filePath: string) => void;
  onCreateAllTests: () => void;
  isGenerating?: boolean;
  generationStatus?: string;
  onCancelTest: (filePath: string) => void;
  onViewTest?: (testFilePath: string) => void;
}

// Icon Components
const FileStatusIcon: React.FC<{
  status?: FileGenerationState["status"];
}> = ({ status }) => {
  if (status === "generating") {
    return (
      <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
    );
  }
  if (status === "completed") {
    return (
      <span className="flex-shrink-0">
        <CheckCircle className="h-3 w-3 text-green-500" />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex-shrink-0">
        <AlertCircle className="h-3 w-3 text-destructive" />
      </span>
    );
  }
  return null;
};

const LogIcon: React.FC<{
  log: string;
  isCompleted?: boolean;
}> = ({ log, isCompleted }) => {
  const lowerLog = log.toLowerCase();

  // Check if this is a "generating" message
  const isGeneratingMessage = lowerLog.includes("generating");

  // If generating and file is completed, show checkmark instead of spinner
  if (isGeneratingMessage && isCompleted) {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }

  if (lowerLog.includes("reading") || lowerLog.includes("read file")) {
    return <FileSearch className="h-3 w-3" />;
  }
  if (
    lowerLog.includes("writing") ||
    lowerLog.includes("written") ||
    lowerLog.includes("write test")
  ) {
    return <FileOutput className="h-3 w-3" />;
  }
  if (lowerLog.includes("config") || lowerLog.includes("configuration")) {
    return <Settings className="h-3 w-3" />;
  }
  if (lowerLog.includes("starting")) {
    return <Play className="h-3 w-3" />;
  }
  if (lowerLog.includes("completed") || lowerLog.includes("success")) {
    return <CheckCircle className="h-3 w-3 text-green-500" />;
  }
  if (lowerLog.includes("analyzing")) {
    return <Search className="h-3 w-3" />;
  }
  if (isGeneratingMessage) {
    return <Loader2 className="h-3 w-3 animate-spin" />;
  }
  return <Circle className="h-3 w-3" />;
};

// File Row Component
interface FileRowProps {
  file: EligibleFile;
  fileState?: FileGenerationState;
  onCreateTest: (path: string) => void;
  onCancelTest: (path: string) => void;
  onViewTest?: (testFilePath: string) => void;
}

const FileRow: React.FC<FileRowProps> = ({
  file,
  fileState,
  onCreateTest,
  onCancelTest,
  onViewTest,
}) => {
  const isFileGenerating = fileState?.status === "generating";
  const isCompleted = fileState?.status === "completed";
  const hasTestFile = isCompleted && fileState?.testFilePath;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {isFileGenerating ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
        ) : (
          <FileStatusIcon status={fileState?.status} />
        )}
        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
        <span className="text-xs font-mono w-4 flex-shrink-0 text-muted-foreground">
          {file.status}
        </span>
        <span
          className="text-sm flex-1 truncate text-muted-foreground"
          title={file.path}
        >
          {truncateMiddle(file.relativePath)}
        </span>
      </div>
      <div className="flex items-center gap-1">
        {isFileGenerating ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-6 px-2 flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onCancelTest(file.path);
            }}
          >
            <XCircle className="h-3 w-3 mr-1" />
            Cancel
          </Button>
        ) : (
          <>
            {hasTestFile && onViewTest && fileState.testFilePath && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  const testPath = fileState.testFilePath;
                  if (testPath) {
                    onViewTest(testPath);
                  }
                }}
              >
                <Eye className="h-3 w-3 mr-1" />
                View Test
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onCreateTest(file.path);
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Test
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

// File Item with Accordion (for generating and completed states)
interface FileItemWithAccordionProps {
  file: EligibleFile;
  fileState: FileGenerationState;
  onCreateTest: (path: string) => void;
  onCancelTest: (path: string) => void;
  onViewTest?: (testFilePath: string) => void;
}

const FileItemWithAccordion: React.FC<FileItemWithAccordionProps> = ({
  file,
  fileState,
  onCreateTest,
  onCancelTest,
  onViewTest,
}) => {
  return (
    <Task defaultOpen={true}>
      <TaskTrigger title={file.path} className="flex-1 min-w-0">
        <div title={file.path} className="w-full">
          <FileRow
            file={file}
            fileState={fileState}
            onCreateTest={onCreateTest}
            onCancelTest={onCancelTest}
            onViewTest={onViewTest}
          />
        </div>
      </TaskTrigger>
      <TaskContent>
        {fileState.logs.map((log, i) => (
          <TaskItem
            key={`${file.path}-log-${i}-${log.slice(0, 20)}`}
            className="flex items-center gap-2"
          >
            <span className="flex-shrink-0">
              <LogIcon
                log={log}
                isCompleted={fileState.status === "completed"}
              />
            </span>
            <span className="flex-1 truncate" title={log}>
              {truncateLogMessage(log)}
            </span>
          </TaskItem>
        ))}
        {fileState.error && (
          <TaskItem className="text-destructive flex items-center gap-2">
            <AlertCircle className="h-3 w-3 flex-shrink-0" />
            <span className="flex-1 truncate" title={fileState.error}>
              {fileState.error}
            </span>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  );
};

// File Item Component (chooses between accordion and simple row)
interface FileItemProps {
  file: EligibleFile;
  fileState?: FileGenerationState;
  onCreateTest: (path: string) => void;
  onCancelTest: (path: string) => void;
  onViewTest?: (testFilePath: string) => void;
}

const FileItem: React.FC<FileItemProps> = ({
  file,
  fileState,
  onCreateTest,
  onCancelTest,
  onViewTest,
}) => {
  // Show accordion for generating or completed states (to see logs/steps)
  if (
    fileState?.status === "generating" ||
    (fileState?.status === "completed" && fileState.logs.length > 0)
  ) {
    return (
      <FileItemWithAccordion
        file={file}
        fileState={fileState}
        onCreateTest={onCreateTest}
        onCancelTest={onCancelTest}
        onViewTest={onViewTest}
      />
    );
  }

  return (
    <div className="flex items-center gap-2">
      <FileRow
        file={file}
        fileState={fileState}
        onCreateTest={onCreateTest}
        onCancelTest={onCancelTest}
        onViewTest={onViewTest}
      />
    </div>
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
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Edit branch"
      >
        <FileText className="h-3 w-3" />
      </button>
    </CardDescription>
  </CardHeader>
);

interface BranchContentProps {
  files: EligibleFile[];
  fileStates: Map<string, FileGenerationState>;
  onCreateTest: (filePath: string) => void;
  onCancelTest: (filePath: string) => void;
  onCreateAllTests: () => void;
  isGenerating?: boolean;
  generationStatus?: string;
  onViewTest?: (testFilePath: string) => void;
}

const BranchContent: React.FC<BranchContentProps> = ({
  files,
  fileStates,
  onCreateTest,
  onCancelTest,
  onCreateAllTests,
  isGenerating = false,
  generationStatus = "",
  onViewTest,
}) => (
  <CardContent className="space-y-2">
    <div className="space-y-2">
      {files.map((file) => {
        const fileState = fileStates.get(file.path);
        return (
          <FileItem
            key={file.path}
            file={file}
            fileState={fileState}
            onCreateTest={onCreateTest}
            onCancelTest={onCancelTest}
            onViewTest={onViewTest}
          />
        );
      })}
    </div>

    <div className="pt-2 border-t space-y-2">
      {isGenerating && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-muted/50">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Generating test plan...</p>
            {generationStatus && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {generationStatus}
              </p>
            )}
          </div>
        </div>
      )}
      <Button
        variant="outline"
        className="w-full"
        onClick={onCreateAllTests}
        disabled={isGenerating}
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <Plus className="h-4 w-4 mr-2" />
            Create Tests for All Changes
          </>
        )}
      </Button>
    </div>
  </CardContent>
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
          fileStates={props.fileStates}
          onCreateTest={props.onCreateTest}
          onCancelTest={props.onCancelTest}
          onCreateAllTests={props.onCreateAllTests}
          isGenerating={props.isGenerating}
          generationStatus={props.generationStatus}
          onViewTest={props.onViewTest}
        />
      )}
    </Card>
  );
};

export default BranchChanges;
