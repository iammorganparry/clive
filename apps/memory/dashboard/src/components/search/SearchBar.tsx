import type { SearchMode, Workspace } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SEARCH_MODES } from "@/lib/constants";
import { Search } from "lucide-react";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  mode: SearchMode;
  onModeChange: (m: SearchMode) => void;
  workspaceId: string;
  onWorkspaceChange: (id: string) => void;
  workspaces: Workspace[];
  onSearch: () => void;
  isLoading: boolean;
}

export function SearchBar({
  query,
  onQueryChange,
  mode,
  onModeChange,
  workspaceId,
  onWorkspaceChange,
  workspaces,
  onSearch,
  isLoading,
}: SearchBarProps) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex flex-1 gap-2">
        <Input
          placeholder="Search memories..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          className="min-w-[200px]"
        />
        <Button onClick={onSearch} disabled={isLoading || !query.trim()}>
          <Search className="size-4" />
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </div>

      <Select value={mode} onValueChange={(v) => onModeChange(v as SearchMode)}>
        <SelectTrigger className="w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SEARCH_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={workspaceId || "all"}
        onValueChange={(v) => onWorkspaceChange(v === "all" ? "" : v)}
      >
        <SelectTrigger className="w-[180px]">
          <SelectValue placeholder="Workspace" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All workspaces</SelectItem>
          {workspaces.map((ws) => (
            <SelectItem key={ws.id} value={ws.id}>
              {ws.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
