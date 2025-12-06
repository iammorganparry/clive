import type React from "react";
import { useState, useCallback } from "react";
import { Button } from "../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card.js";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  FileText,
  Plus,
} from "lucide-react";

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

interface BranchChangesProps {
  changes: BranchChangesData | null;
  isLoading: boolean;
  error?: string;
  onCreateTest: (filePath: string) => void;
  onCreateAllTests: () => void;
}

const BranchChanges: React.FC<BranchChangesProps> = ({
  changes,
  isLoading,
  error,
  onCreateTest,
  onCreateAllTests,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription>Loading changed files...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription className="text-destructive">
            {error}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!changes || changes.files.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Branch Changes</CardTitle>
          <CardDescription>
            No eligible files changed on this branch
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { branchName, files } = changes;

  return (
    <Card>
      <CardHeader>
        <button
          type="button"
          onClick={handleToggle}
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

      {isExpanded && (
        <CardContent className="space-y-2">
          <div className="space-y-1">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 transition-colors cursor-pointer group focus:outline-none focus:ring-2 focus:ring-ring w-full text-left"
                onClick={() => onCreateTest(file.path)}
              >
                <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-xs font-mono text-muted-foreground w-4 flex-shrink-0">
                  {file.status}
                </span>
                <span className="text-sm text-foreground flex-1 truncate">
                  {file.relativePath}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-opacity h-6 px-2"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateTest(file.path);
                  }}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Test
                </Button>
              </button>
            ))}
          </div>

          <div className="pt-2 border-t">
            <Button
              variant="outline"
              className="w-full"
              onClick={onCreateAllTests}
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Tests for All Changes
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
};

export default BranchChanges;
