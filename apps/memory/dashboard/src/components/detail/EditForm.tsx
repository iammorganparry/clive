import { useState } from "react";
import type { Memory, MemoryType, Tier } from "@/api/types";
import { useUpdateMemory } from "@/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMORY_TYPES, TIERS, MEMORY_TYPE_LABELS } from "@/lib/constants";
import { Save } from "lucide-react";

interface EditFormProps {
  memory: Memory;
}

export function EditForm({ memory }: EditFormProps) {
  const update = useUpdateMemory();
  const [confidence, setConfidence] = useState(String(memory.confidence));
  const [tier, setTier] = useState<Tier>(memory.tier);
  const [memoryType, setMemoryType] = useState<MemoryType>(memory.memoryType);
  const [tags, setTags] = useState((memory.tags ?? []).join(", "));

  function handleSave() {
    const parsedConf = parseFloat(confidence);
    update.mutate({
      id: memory.id,
      confidence: isNaN(parsedConf) ? undefined : parsedConf,
      tier: tier !== memory.tier ? tier : undefined,
      memoryType: memoryType !== memory.memoryType ? memoryType : undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Edit</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Type</label>
          <Select
            value={memoryType}
            onValueChange={(v) => setMemoryType(v as MemoryType)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEMORY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {MEMORY_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Tier</label>
          <Select
            value={tier}
            onValueChange={(v) => setTier(v as Tier)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "short" ? "Short-term" : "Long-term"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Confidence (0-1)
          </label>
          <Input
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={confidence}
            onChange={(e) => setConfidence(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">
            Tags (comma-separated)
          </label>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tag1, tag2"
          />
        </div>

        <Button
          size="sm"
          onClick={handleSave}
          disabled={update.isPending}
        >
          <Save className="size-4" />
          {update.isPending ? "Saving..." : "Save changes"}
        </Button>
      </CardContent>
    </Card>
  );
}
