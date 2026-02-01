import { useState } from "react";
import { useSearch, useWorkspaces } from "@/api/hooks";
import type { SearchMode } from "@/api/types";
import { SearchBar } from "./SearchBar";
import { ResultCard } from "./ResultCard";
import { Card, CardContent } from "@/components/ui/card";

export function SearchPage() {
  const search = useSearch();
  const { data: workspaces } = useWorkspaces();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("hybrid");
  const [workspaceId, setWorkspaceId] = useState("");

  function handleSearch() {
    if (!query.trim()) return;
    const workspace = workspaces?.find((ws) => ws.id === workspaceId);
    search.mutate({
      query: query.trim(),
      searchMode: mode,
      workspace: workspace?.path ?? "",
      includeGlobal: true,
      maxResults: 20,
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Search</h1>

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        mode={mode}
        onModeChange={setMode}
        workspaceId={workspaceId}
        onWorkspaceChange={setWorkspaceId}
        workspaces={workspaces ?? []}
        onSearch={handleSearch}
        isLoading={search.isPending}
      />

      {search.data && (
        <div className="space-y-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{search.data.meta.totalResults} results</span>
            <span>{search.data.meta.searchTimeMs}ms</span>
            <span>
              Vector: {search.data.meta.vectorResults} | BM25: {search.data.meta.bm25Results}
            </span>
          </div>
          {search.data.results.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No results found.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {search.data.results.map((result) => (
                <ResultCard key={result.id} result={result} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
