/**
 * Centralized AI model configuration
 * All model names should be referenced from here to ensure consistency
 */
export const AIModels = {
  testing: {
    low:  "claude-haiku-4-5",
    medium: "claude-sonnet-4-5",
    high: "claude-opus-4-5",
  },
  // Anthropic models
  anthropic: {
    /** High-capability reasoning model for planning and complex tasks */
    testing: "claude-haiku-4-5",
  },

  // xAI models
  xai: {
    /** Fast code generation model from xAI */
    codeFast: "grok-code-fast-1",
    fastNonReasoning: "grok-4-fast-non-reasoning",
  },

  // OpenAI models
  openai: {
    /** Embedding model for semantic search (1536 dimensions) */
    embedding: "text-embedding-3-small",
  },

  knowledgeBase: {
    /** Model for knowledge base analysis */
    analysis: "grok-code-fast-1",
  },
} as const;

// Type helpers for type-safe model references
export type AnthropicModel =
  (typeof AIModels.anthropic)[keyof typeof AIModels.anthropic];
export type XAIModel = (typeof AIModels.xai)[keyof typeof AIModels.xai];
export type OpenAIEmbeddingModel =
  (typeof AIModels.openai)[keyof typeof AIModels.openai];
