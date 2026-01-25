import {
  AlertCircle,
  Check,
  FileText,
  Loader2,
  X,
  XCircle,
} from "lucide-react";
import type React from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
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
          border: "border-l-4 border-l-success",
          bg: "bg-success-muted",
          icon: <Check className="h-4 w-4 text-success" />,
        };
      case "error":
        return {
          border: "border-l-4 border-l-destructive",
          bg: "bg-error-muted",
          icon: <AlertCircle className="h-4 w-4 text-destructive" />,
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
                    className="h-7 px-2 text-success hover:text-success-foreground hover:bg-success-muted"
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
                    className="h-7 px-2 text-destructive hover:text-destructive/80 hover:bg-error-muted"
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
                  className="h-7 px-2 text-warning hover:text-warning-foreground hover:bg-warning/10"
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
            <div className="text-destructive mt-1">{error}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default TestCard;
