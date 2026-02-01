import { useHealth } from "@/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";

function ServiceDot({ status }: { status: string | undefined }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full",
        status === "ok" ? "bg-success" : status === "error" ? "bg-destructive" : "bg-muted-foreground",
      )}
    />
  );
}

export function HealthCard() {
  const { data: health, isLoading } = useHealth();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-4 text-sm text-muted-foreground">
          Checking health...
        </CardContent>
      </Card>
    );
  }

  if (!health) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="size-4" />
          System Health
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6">
          <div className="flex items-center gap-2 text-sm">
            <ServiceDot status={health.ollama.status} />
            <span>Ollama</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ServiceDot status={health.qdrant.status} />
            <span>Qdrant</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <ServiceDot status={health.db.status} />
            <span>SQLite</span>
          </div>
          <div className="ml-auto text-sm text-muted-foreground">
            {health.memoryCount} total memories
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
