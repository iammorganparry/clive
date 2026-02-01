import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import type { SearchResult } from "@/api/types";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MEMORY_TYPE_COLORS, MEMORY_TYPE_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface ResultCardProps {
  result: SearchResult;
}

export function ResultCard({ result }: ResultCardProps) {
  const navigate = useNavigate();
  const scorePercent = Math.round(result.score * 100);

  return (
    <Card
      className="cursor-pointer transition-colors hover:bg-accent/30"
      onClick={() => navigate(`/memories/${result.id}`)}
    >
      <CardContent className="space-y-2 py-4">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("text-[10px]", MEMORY_TYPE_COLORS[result.memoryType])}
          >
            {MEMORY_TYPE_LABELS[result.memoryType] ?? result.memoryType}
          </Badge>
          <Badge variant={result.tier === "long" ? "default" : "secondary"}>
            {result.tier}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDistanceToNow(result.createdAt * 1000, { addSuffix: true })}
          </span>
        </div>
        <p className="text-sm leading-relaxed">{result.content}</p>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Score:</span>
            <div className="h-1.5 w-24 rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.min(scorePercent, 100)}%` }}
              />
            </div>
            <span className="tabular-nums">{scorePercent}%</span>
          </div>
          <span className="text-xs text-muted-foreground">
            Confidence: {(result.confidence * 100).toFixed(0)}%
          </span>
          {result.tags && result.tags.length > 0 && (
            <div className="flex gap-1">
              {result.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
