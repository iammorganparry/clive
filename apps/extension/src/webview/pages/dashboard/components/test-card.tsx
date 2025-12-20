import type React from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import {
  Check,
  X,
  Loader2,
  FileText,
  AlertCircle,
  XCircle,
} from "lucide-react";
import type {
  ProposedTest,
  TestExecutionStatus,
} from "../../../../services/ai-agent/types.js";

interface TestCardProps {
  test: ProposedTest;
  status: TestExecutionStatus;
  error?: string;
  testFilePath?: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onCancel?: (id: string) => void;
  onPreviewDiff?: (test: ProposedTest) => void;
  onNavigateToChat?: (sourceFile: string) => void;
}

const TestCard: React.FC<TestCardProps> = ({
  test,
  status,
  error,
  testFilePath,
  onAccept,
  onReject,
  onCancel,
  onPreviewDiff,
  onNavigateToChat,
}) => {
  const getStatusStyles = () => {
    switch (status) {
      case "pending":
        return {
          border: "border-border",
          bg: "bg-card",
          icon: null,
        };
      case "accepted":
        return {
          border: "border-l-4 border-l-green-500",
          bg: "bg-card",
          icon: <Check className="h-4 w-4 text-green-500" />,
        };
      case "rejected":
        return {
          border: "border-l-4 border-l-red-500 opacity-60",
          bg: "bg-card",
          icon: <X className="h-4 w-4 text-red-500" />,
        };
      case "in_progress":
        return {
          border: "border-l-4 border-l-blue-500",
          bg: "bg-card",
          icon: <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />,
        };
      case "completed":
        return {
          border: "border-l-4 border-l-green-500",
          bg: "bg-green-50 dark:bg-green-950/20",
          icon: <Check className="h-4 w-4 text-green-500" />,
        };
      case "error":
        return {
          border: "border-l-4 border-l-red-500",
          bg: "bg-red-50 dark:bg-red-950/20",
          icon: <AlertCircle className="h-4 w-4 text-red-500" />,
        };
    }
  };

  const styles = getStatusStyles();
  const showActions = status === "pending";
  const showCancel = status === "pending" || status === "in_progress";

  const handleCardClick = () => {
    if (onNavigateToChat) {
      onNavigateToChat(test.sourceFile);
    }
  };

  return (
    <Card
      className={`${styles.border} ${styles.bg} transition-colors ${
        onNavigateToChat ? "cursor-pointer hover:bg-muted/50" : ""
      }`}
      onClick={onNavigateToChat ? handleCardClick : undefined}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {styles.icon && (
              <div className="mt-0.5 flex-shrink-0">{styles.icon}</div>
            )}
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPreviewDiff?.(test);
                  }}
                  className="truncate text-left hover:text-primary hover:underline cursor-pointer"
                  title="Click to preview diff"
                >
                  {test.targetTestPath}
                </button>
                {test.isUpdate && (
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    Update
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                {test.description}
              </CardDescription>
            </div>
          </div>
          {(showActions || showCancel) && (
            <div className="flex items-center gap-1 flex-shrink-0">
              {showActions && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      onAccept(test.id);
                    }}
                    title="Accept"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
                    onClick={(e) => {
                      e.stopPropagation();
                      onReject(test.id);
                    }}
                    title="Reject"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
              {showCancel && onCancel && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-orange-600 hover:text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:text-orange-300 dark:hover:bg-orange-950/30"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(test.id);
                  }}
                  title="Cancel"
                >
                  <XCircle className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground font-medium">Source:</span>
            <span className="font-mono text-muted-foreground truncate">
              {test.sourceFile}
            </span>
          </div>
          {testFilePath && status === "completed" && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground font-medium">
                Created:
              </span>
              <span className="font-mono text-muted-foreground truncate">
                {testFilePath}
              </span>
            </div>
          )}
          {error && status === "error" && (
            <div className="text-red-600 dark:text-red-400 mt-1">{error}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TestCard;
