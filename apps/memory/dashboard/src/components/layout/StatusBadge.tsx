import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string | undefined;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "ml-auto size-2 rounded-full",
        status === "ok"
          ? "bg-success"
          : status === "degraded"
            ? "bg-warning"
            : "bg-muted-foreground",
      )}
      title={status ?? "unknown"}
    />
  );
}
