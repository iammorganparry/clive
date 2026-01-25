import { type AnthropicProvider, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createXai } from "@ai-sdk/xai";
import type { AiTokenResult } from "./config-service.js";

/**
 * Vercel AI Gateway base URL
 * @see https://vercel.com/docs/ai-gateway/openai-compatible-api
 */
const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/**
 * Provider interface for embeddings
 * Matches the OpenAI SDK pattern: provider.embedding(modelName)
 */
export interface EmbeddingProvider {
  embedding: OpenAIProvider["embedding"];
}

/**
 * Provider interface for language models
 * Callable function that returns a LanguageModel (matches Anthropic pattern)
 */
export type LanguageModelProvider = AnthropicProvider;

/**
 * Creates an embedding provider based on token type.
 *
 * For gateway tokens: Uses OpenAI-compatible API with prefixed model names
 * For direct tokens: Uses native OpenAI SDK
 *
 * @example
 * ```ts
 * const provider = createEmbeddingProvider(tokenResult);
 * const model = provider.embedding('text-embedding-3-small');
 * await embedMany({ model, values: texts });
 * ```
 *
 * @contract AIGateway.openai
 * @see contracts/system.md#AIGateway.openai
 */
export const createEmbeddingProvider = (tokenResult: AiTokenResult) => {
  if (tokenResult.isGateway) {
    // Gateway pattern: createOpenAICompatible with gateway URL
    // Model names need provider prefix: 'openai/text-embedding-3-small'
    const gateway = createOpenAICompatible({
      name: "gateway",
      apiKey: tokenResult.token,
      baseURL: AI_GATEWAY_BASE_URL,
    });

    return {
      embedding: (modelName: string) => {
        // Prefix with 'openai/' for gateway routing
        const prefixedModel = `openai/${modelName}`;
        return gateway.textEmbeddingModel(prefixedModel);
      },
    } as unknown as EmbeddingProvider;
  }

  // Direct OpenAI: use native SDK
  const openai = createOpenAI({ apiKey: tokenResult.token });
  return {
    embedding: (modelName: string) => openai.embedding(modelName),
  };
};

/**
 * Creates an Anthropic language model provider based on token type.
 *
 * For gateway tokens: Uses OpenAI-compatible API with prefixed model names
 * For direct tokens: Uses native Anthropic SDK
 *
 * @example
 * ```ts
 * const anthropic = createAnthropicProvider(tokenResult);
 * const model = anthropic('claude-opus-4-5');
 * await generateText({ model, prompt: '...' });
 * ```
 *
 * @contract AIGateway.anthropic
 * @see contracts/system.md#AIGateway.anthropic
 */
export const createAnthropicProvider = (tokenResult: AiTokenResult) => {
  if (tokenResult.isGateway) {
    // Gateway pattern: gateway('anthropic/claude-sonnet-4')
    // @see https://vercel.com/docs/ai-gateway/openai-compatible-api#ai-sdk-4
    const gateway = createOpenAICompatible({
      name: "gateway",
      apiKey: tokenResult.token,
      baseURL: AI_GATEWAY_BASE_URL,
    });

    // Return a callable that prefixes model names for gateway routing
    return (modelName: string) => {
      const prefixedModel = `anthropic/${modelName}`;
      return gateway(prefixedModel);
    };
  }

  // Direct Anthropic: use native SDK
  return createAnthropic({ apiKey: tokenResult.token });
};

/**
 * Creates an xAI language model provider based on token type.
 *
 * For gateway tokens: Uses OpenAI-compatible API with prefixed model names
 * For direct tokens: Uses native xAI SDK
 *
 * @example
 * ```ts
 * const xai = createXaiProvider(tokenResult);
 * const model = xai('grok-code-fast-1');
 * await generateText({ model, prompt: '...' });
 * ```
 *
 * @contract AIGateway.xai
 * @see contracts/system.md#AIGateway.xai
 */
export const createXaiProvider = (tokenResult: AiTokenResult) => {
  if (tokenResult.isGateway) {
    // Gateway pattern: gateway('xai/grok-code-fast-1')
    const gateway = createOpenAICompatible({
      name: "gateway",
      apiKey: tokenResult.token,
      baseURL: AI_GATEWAY_BASE_URL,
    });

    // Return a callable that prefixes model names for gateway routing
    return (modelName: string) => {
      const prefixedModel = `xai/${modelName}`;
      return gateway(prefixedModel);
    };
  }

  // Direct xAI: use native SDK
  return createXai({ apiKey: tokenResult.token });
};
