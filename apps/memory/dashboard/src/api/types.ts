export type MemoryType =
  | "WORKING_SOLUTION"
  | "GOTCHA"
  | "PATTERN"
  | "DECISION"
  | "FAILURE"
  | "PREFERENCE"
  | "CONTEXT"
  | "SKILL_HINT";

export type Tier = "short" | "long";

export type SearchMode = "hybrid" | "vector" | "bm25";

export interface Memory {
  id: string;
  workspaceId: string;
  content: string;
  memoryType: MemoryType;
  tier: Tier;
  confidence: number;
  accessCount: number;
  tags: string[] | null;
  source: string;
  sessionId: string;
  contentHash: string;
  relatedFiles?: string[] | null;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number | null;
}

export interface Workspace {
  id: string;
  path: string;
  name: string;
  createdAt: number;
  lastAccessedAt: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ListResponse {
  memories: Memory[];
  pagination: Pagination;
}

export interface ListParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
  workspace_id?: string;
  memory_type?: string;
  tier?: string;
  source?: string;
}

export interface SearchRequest {
  workspace: string;
  query: string;
  maxResults?: number;
  minScore?: number;
  memoryTypes?: MemoryType[];
  tier?: string;
  includeGlobal?: boolean;
  searchMode?: SearchMode;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number;
  memoryType: MemoryType;
  tier: Tier;
  confidence: number;
  tags: string[] | null;
  source: string;
  createdAt: number;
}

export interface SearchMeta {
  totalResults: number;
  vectorResults: number;
  bm25Results: number;
  searchTimeMs: number;
}

export interface SearchResponse {
  results: SearchResult[];
  meta: SearchMeta;
}

export interface UpdateRequest {
  tier?: Tier;
  confidence?: number;
  tags?: string[];
  content?: string;
  memoryType?: MemoryType;
}

export interface WorkspaceStats {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  totalMemories: number;
  shortTermCount: number;
  longTermCount: number;
  byType: Record<string, number>;
  lastAccessedAt: number;
}

export interface ServiceCheck {
  status: string;
  message?: string;
}

export interface HealthResponse {
  status: string;
  ollama: ServiceCheck;
  qdrant: ServiceCheck;
  db: ServiceCheck;
  memoryCount: number;
}

export interface CompactResponse {
  expired: number;
  promoted: number;
}
