import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import type { Memory } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface RecentMemoriesProps {
  memories: Memory[];
}

export function RecentMemories({ memories }: RecentMemoriesProps) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Recent Memories</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {memories.length === 0 && (
          <p className="text-sm text-muted-foreground">No memories yet.</p>
        )}
        {memories.map((m) => (
          <button
            key={m.id}
            onClick={() => navigate(`/memories/${m.id}`)}
            className="flex w-full items-start gap-3 rounded-md p-2 text-left transition-colors hover:bg-accent/50"
          >
            <Badge
              variant="outline"
              className={cn("mt-0.5 shrink-0 text-[10px]", MEMORY_TYPE_COLORS[m.memoryType])}
            >
              {MEMORY_TYPE_LABELS[m.memoryType] ?? m.memoryType}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{m.content}</p>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(m.createdAt * 1000, { addSuffix: true })}
              </p>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
