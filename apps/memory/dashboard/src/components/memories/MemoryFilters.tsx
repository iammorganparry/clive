import { useWorkspaces } from "@/api/hooks";
import type { ListParams } from "@/api/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMORY_TYPES, TIERS, MEMORY_TYPE_LABELS } from "@/lib/constants";

interface MemoryFiltersProps {
  params: ListParams;
  onChange: (updates: Partial<ListParams>) => void;
}

export function MemoryFilters({ params, onChange }: MemoryFiltersProps) {
  const { data: workspaces } = useWorkspaces();

  return (
    <div className="flex flex-wrap gap-3">
      <Select
        value={params.workspace_id ?? "all"}
        onValueChange={(v) =>
          onChange({ workspace_id: v === "all" ? undefined : v })
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Workspace" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All workspaces</SelectItem>
          {workspaces?.map((ws) => (
            <SelectItem key={ws.id} value={ws.id}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={params.memory_type ?? "all"}
        onValueChange={(v) =>
          onChange({ memory_type: v === "all" ? undefined : v })
        }
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All types</SelectItem>
          {MEMORY_TYPES.map((t) => (
            <SelectItem key={t} value={t}>
              {MEMORY_TYPE_LABELS[t]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={params.tier ?? "all"}
        onValueChange={(v) =>
          onChange({ tier: v === "all" ? undefined : v })
        }
      >
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Tier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All tiers</SelectItem>
          {TIERS.map((t) => (
            <SelectItem key={t} value={t}>
              {t === "short" ? "Short-term" : "Long-term"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
