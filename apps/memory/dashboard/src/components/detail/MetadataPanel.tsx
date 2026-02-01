import { format } from "date-fns";
import type { Memory } from "@/api/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileCode } from "lucide-react";

interface MetadataPanelProps {
  memory: Memory;
}

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{String(value)}</span>
    </div>
  );
}

export function MetadataPanel({ memory }: MetadataPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Metadata</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Row label="ID" value={memory.id} />
        <Row label="Workspace ID" value={memory.workspaceId} />
        <Row label="Content Hash" value={memory.contentHash} />
        <Row label="Source" value={memory.source} />
        <Row label="Session ID" value={memory.sessionId} />
        <Row label="Access Count" value={memory.accessCount} />
        <Row
          label="Created"
          value={format(memory.createdAt * 1000, "yyyy-MM-dd HH:mm:ss")}
        />
        <Row
          label="Updated"
          value={format(memory.updatedAt * 1000, "yyyy-MM-dd HH:mm:ss")}
        />
        {memory.expiresAt && (
          <Row
            label="Expires"
            value={format(memory.expiresAt * 1000, "yyyy-MM-dd HH:mm:ss")}
          />
        )}
        {memory.relatedFiles && memory.relatedFiles.length > 0 && (
          <div className="pt-2 border-t">
            <span className="text-sm text-muted-foreground">Related Files</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {memory.relatedFiles.map((f) => (
                <Badge
                  key={f}
                  variant="secondary"
                  className="gap-1 text-xs font-normal font-mono"
                  title={f}
                >
                  <FileCode className="size-3" />
                  {f}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
