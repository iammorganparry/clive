import { useSearchParams } from "react-router-dom";
import { useMemories, useCompact } from "@/api/hooks";
import { MemoryFilters } from "./MemoryFilters";
import { MemoriesTable } from "./MemoriesTable";
import { Button } from "@/components/ui/button";
import { Recycle } from "lucide-react";
import type { ListParams } from "@/api/types";

export function MemoriesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const compact = useCompact();

  const params: ListParams = {
    page: Number(searchParams.get("page")) || 1,
    limit: Number(searchParams.get("limit")) || 50,
    sort: searchParams.get("sort") ?? "created_at",
    order: (searchParams.get("order") as "asc" | "desc") ?? "desc",
    workspace_id: searchParams.get("workspace_id") ?? undefined,
    memory_type: searchParams.get("memory_type") ?? undefined,
    tier: searchParams.get("tier") ?? undefined,
    source: searchParams.get("source") ?? undefined,
  };

  const { data, isLoading } = useMemories(params);

  function updateParams(updates: Partial<ListParams>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        next.set(key, String(value));
      } else {
        next.delete(key);
      }
    }
    // Reset to page 1 when filters change
    if (!("page" in updates)) {
      next.set("page", "1");
    }
    setSearchParams(next);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Memories</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => compact.mutate()}
          disabled={compact.isPending}
        >
          <Recycle className="size-4" />
          {compact.isPending ? "Compacting..." : "Compact"}
        </Button>
      </div>

      <MemoryFilters params={params} onChange={updateParams} />

      <MemoriesTable
        memories={data?.memories ?? []}
        pagination={data?.pagination}
        isLoading={isLoading}
        params={params}
        onParamsChange={updateParams}
      />
    </div>
  );
}
