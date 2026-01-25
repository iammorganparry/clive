import { AlertCircle, CheckCircle2, Info, XCircle } from "lucide-react";
import { Button } from "../../button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../card";

export interface ResultCardProps {
  variant: "success" | "error" | "warning" | "info";
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

const variantConfig = {
  success: {
    icon: CheckCircle2,
    iconColor: "text-green-500",
    bgColor: "bg-green-500/10",
  },
  error: {
    icon: XCircle,
    iconColor: "text-destructive",
    bgColor: "bg-destructive/10",
  },
  warning: {
    icon: AlertCircle,
    iconColor: "text-yellow-500",
    bgColor: "bg-yellow-500/10",
  },
  info: {
    icon: Info,
    iconColor: "text-primary",
    bgColor: "bg-primary/10",
  },
};

/**
 * Generic result display card for success/error/warning/info states.
 */
export function ResultCard({
  variant,
  title,
  description,
  action,
  className,
}: ResultCardProps) {
  const config = variantConfig[variant];
  const Icon = config.icon;

  return (
    <Card
      className={`w-full max-w-md border-0 bg-card/50 backdrop-blur ${className ?? ""}`}
    >
      <CardHeader className="text-center">
        <div
          className={`mx-auto mb-3 flex size-12 items-center justify-center rounded-full ${config.bgColor}`}
        >
          <Icon className={`size-6 ${config.iconColor}`} />
        </div>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {action && (
        <CardContent>
          <Button variant="outline" className="w-full" onClick={action.onClick}>
            {action.label}
          </Button>
        </CardContent>
      )}
    </Card>
  );
}
