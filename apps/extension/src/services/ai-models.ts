/**
 * Centralized AI model configuration
 * All model names should be referenced from here to ensure consistency
 */
export const AIModels = {
  // Anthropic models
  anthropic: {
    /** High-capability reasoning model for planning and complex tasks */
    planning: "claude-opus-4-5",
    /** Fast model for execution and simple tasks */
    execution: "claude-haiku-4-5",
  },

  // OpenAI models
  openai: {
    /** Embedding model for semantic search (1536 dimensions) */
    embedding: "text-embedding-3-small",
  },
} as const;

// Type helpers for type-safe model references
export type AnthropicModel =
  (typeof AIModels.anthropic)[keyof typeof AIModels.anthropic];
export type OpenAIEmbeddingModel =
  (typeof AIModels.openai)[keyof typeof AIModels.openai];
