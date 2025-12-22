import { ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "../../button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../card";

export interface DeviceAuthPendingProps {
  userCode: string;
  verificationUri?: string;
  onCancel?: () => void;
  onOpenBrowser?: () => void;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Displays when waiting for user to authorize device in browser.
 * Shows the code and a spinner with action buttons.
 */
export function DeviceAuthPending({
  userCode,
  verificationUri,
  onCancel,
  onOpenBrowser,
  title = "Enter Code in Browser",
  description = "A browser window has opened. Enter the code below to connect your account.",
  className,
}: DeviceAuthPendingProps) {
  const formatUserCode = (code: string) => {
    if (code.length > 4) {
      return `${code.slice(0, 4)}-${code.slice(4)}`;
    }
    return code;
  };

  const handleOpenBrowser = () => {
    if (verificationUri) {
      if (typeof window !== "undefined") {
        window.open(verificationUri, "_blank");
      }
    }
    onOpenBrowser?.();
  };

  return (
    <div
      className={`flex items-center justify-center h-screen p-6 ${className ?? ""}`}
    >
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Loader2 className="size-6 text-primary animate-spin" />
          </div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-2">Your code</p>
            <p className="text-4xl font-mono font-bold tracking-widest">
              {formatUserCode(userCode)}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {(verificationUri || onOpenBrowser) && (
              <Button variant="outline" onClick={handleOpenBrowser}>
                <ExternalLink className="mr-2 size-4" />
                Open Browser Again
              </Button>
            )}
            {onCancel && (
              <Button variant="ghost" onClick={onCancel}>
                <X className="mr-2 size-4" />
                Cancel
              </Button>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Waiting for authorization...
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
