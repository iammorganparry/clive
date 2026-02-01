import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "./client";
import type {
  HealthResponse,
  ListResponse,
  ListParams,
  Memory,
  Workspace,
  WorkspaceStats,
  SearchRequest,
  SearchResponse,
  UpdateRequest,
  CompactResponse,
} from "./types";

function buildQuery(params: ListParams): string {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.sort) sp.set("sort", params.sort);
  if (params.order) sp.set("order", params.order);
  if (params.workspace_id) sp.set("workspace_id", params.workspace_id);
  if (params.memory_type) sp.set("memory_type", params.memory_type);
  if (params.tier) sp.set("tier", params.tier);
  if (params.source) sp.set("source", params.source);
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthResponse>("/health"),
    refetchInterval: 30_000,
  });
}

export function useMemories(params: ListParams) {
  return useQuery({
    queryKey: ["memories", params],
    queryFn: () =>
      api.get<ListResponse>(`/memories${buildQuery(params)}`),
  });
}

export function useMemory(id: string) {
  return useQuery({
    queryKey: ["memory", id],
    queryFn: () => api.get<Memory>(`/memories/${id}`),
    enabled: !!id,
  });
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ["workspaces"],
    queryFn: () => api.get<Workspace[]>("/workspaces"),
  });
}

export function useWorkspaceStats(id: string | undefined) {
  return useQuery({
    queryKey: ["workspace-stats", id],
    queryFn: () => api.get<WorkspaceStats>(`/workspaces/${id}/stats`),
    enabled: !!id,
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/memories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["workspace-stats"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateRequest & { id: string }) =>
      api.patch<Memory>(`/memories/${id}`, body),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["memory", variables.id] });
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["workspace-stats"] });
    },
  });
}

export function useSearch() {
  return useMutation({
    mutationFn: (req: SearchRequest) =>
      api.post<SearchResponse>("/memories/search", req),
  });
}

export function useCompact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CompactResponse>("/memories/compact"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["memories"] });
      qc.invalidateQueries({ queryKey: ["workspace-stats"] });
      qc.invalidateQueries({ queryKey: ["health"] });
    },
  });
}
