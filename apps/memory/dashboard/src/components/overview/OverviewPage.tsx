import { useState } from "react";
import { useWorkspaces, useWorkspaceStats, useMemories } from "@/api/hooks";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HealthCard } from "./HealthCard";
import { StatsCards } from "./StatsCards";
import { TypeChart } from "./TypeChart";
import { RecentMemories } from "./RecentMemories";

export function OverviewPage() {
  const { data: workspaces } = useWorkspaces();
  const [selectedWs, setSelectedWs] = useState<string>("");
  const { data: stats } = useWorkspaceStats(selectedWs || undefined);
  const { data: recent } = useMemories({
    limit: 10,
    sort: "created_at",
    order: "desc",
    workspace_id: selectedWs || undefined,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <Select value={selectedWs} onValueChange={setSelectedWs}>
          <SelectTrigger className="w-[240px]">
            <SelectValue placeholder="All workspaces" />
          </SelectTrigger>
          <SelectContent>
            {workspaces?.map((ws) => (
              <SelectItem key={ws.id} value={ws.id}>
                {ws.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <HealthCard />

      {stats && <StatsCards stats={stats} />}

      <div className="grid gap-6 lg:grid-cols-2">
        {stats && <TypeChart byType={stats.byType} />}
        <RecentMemories memories={recent?.memories ?? []} />
      </div>
    </div>
  );
}
