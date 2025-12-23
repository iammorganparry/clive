import { Data } from "effect";

/**
 * Shared error classes for knowledge base functionality
 */

/**
 * Knowledge base error - for general knowledge base operations
 */
export class KnowledgeBaseError extends Data.TaggedError("KnowledgeBaseError")<{
  message: string;
  cause?: unknown;
}> {}
