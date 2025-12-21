/**
 * Indexing status types and interfaces
 */

export type IndexingStatus = "idle" | "in_progress" | "complete" | "error";

export interface IndexingStatusInfo {
  status: IndexingStatus;
  repositoryName: string | null;
  repositoryPath: string | null;
  lastIndexedAt: Date | null;
  fileCount: number;
  errorMessage?: string;
}
