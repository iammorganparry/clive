import type React from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import { Check, X, Loader2, AlertCircle, FileText } from "lucide-react";
import type {
  ProposedTest,
  TestExecutionStatus,
} from "../../../../services/ai-agent/types.js";

interface InlineTestCardProps {
  test: ProposedTest;
  status: TestExecutionStatus;
  error?: string;
  testFilePath?: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onPreviewDiff?: (test: ProposedTest) => void;
}

const InlineTestCard: React.FC<InlineTestCardProps> = ({
  test,
  status,
  error,
  testFilePath,
  onAccept,
  onReject,
  onPreviewDiff,
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
          border: "border-l-2 border-l-green-500",
          bg: "bg-card",
          icon: <Check className="h-3 w-3 text-green-500" />,
        };
      case "rejected":
        return {
          border: "border-l-2 border-l-red-500 opacity-60",
          bg: "bg-card",
          icon: <X className="h-3 w-3 text-red-500" />,
        };
      case "in_progress":
        return {
          border: "border-l-2 border-l-blue-500",
          bg: "bg-card",
          icon: <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />,
        };
      case "completed":
        return {
          border: "border-l-2 border-l-green-500",
          bg: "bg-green-50 dark:bg-green-950/20",
          icon: <Check className="h-3 w-3 text-green-500" />,
        };
      case "error":
        return {
          border: "border-l-2 border-l-red-500",
          bg: "bg-red-50 dark:bg-red-950/20",
          icon: <AlertCircle className="h-3 w-3 text-red-500" />,
        };
    }
  };

  const styles = getStatusStyles();
  const showActions = status === "pending";

  return (
    <Card className={`${styles.border} ${styles.bg} transition-colors`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            {styles.icon && (
              <div className="mt-0.5 flex-shrink-0">{styles.icon}</div>
            )}
            <div className="flex-1 min-w-0">
              <CardTitle className="text-xs font-medium flex items-center gap-2">
                <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                <button
                  type="button"
                  onClick={() => onPreviewDiff?.(test)}
                  className="truncate text-left hover:text-primary hover:underline cursor-pointer"
                  title="Click to preview diff"
                >
                  {test.targetTestPath}
                </button>
                {test.isUpdate && (
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-1 py-0.5 rounded">
                    Update
                  </span>
                )}
              </CardTitle>
              <CardDescription className="text-xs mt-0.5">
                {test.description}
              </CardDescription>
            </div>
          </div>
          {showActions && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:text-green-300 dark:hover:bg-green-950/30"
                onClick={() => onAccept(test.id)}
                title="Accept"
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:text-red-300 dark:hover:bg-red-950/30"
                onClick={() => onReject(test.id)}
                title="Reject"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-2">
        <div className="space-y-1 text-xs">
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
            <div className="text-red-600 dark:text-red-400">{error}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default InlineTestCard;
