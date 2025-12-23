/**
 * Shared types for knowledge base functionality
 * These types match the API package types but are defined here
 * to avoid cross-package dependencies in the extension
 */

/**
 * Knowledge base entry
 */
export interface KnowledgeBaseEntry {
  id: string;
  repositoryId: string;
  category: string;
  title: string;
  content: string;
  examples: string[] | null;
  sourceFiles: string[] | null;
  embedding: number[];
  contentHash: string;
  updatedAt: Date;
}

/**
 * Knowledge base search result
 */
export interface KnowledgeBaseSearchResult {
  id: string;
  category: string;
  title: string;
  content: string;
  examples: string[] | null;
  sourceFiles: string[] | null;
  similarity: number;
}

/**
 * Knowledge base status
 */
export interface KnowledgeBaseStatus {
  hasKnowledge: boolean;
  lastUpdatedAt: Date | null;
  categories: string[];
  entryCount: number;
}
