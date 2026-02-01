/**
 * @clive/memory - Embedding Service
 *
 * Effect-TS service for generating embeddings using OpenAI.
 * Includes caching by content hash to avoid re-embedding.
 */

import { Data, Effect } from "effect";
import OpenAI from "openai";
import { EmbeddingDefaults } from "../constants.js";
import type { MemoryChunk } from "../types.js";
import { hashContent } from "../utils/file-utils.js";
import { StorageService } from "./storage-service.js";

/**
 * Error when embedding operation fails
 */
export class EmbeddingError extends Data.TaggedError("EmbeddingError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Configuration for the embedding service
 */
export interface EmbeddingConfig {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use (default: text-embedding-3-small) */
  model?: string;
  /** Batch size for embedding requests (default: 100) */
  batchSize?: number;
}

/**
 * Embedding Service implementation
 */
export class EmbeddingService extends Effect.Service<EmbeddingService>()(
  "EmbeddingService",
  {
    effect: Effect.gen(function* () {
      const storage = yield* StorageService;

      let client: OpenAI | null = null;
      let currentModel: string = EmbeddingDefaults.model;
      let batchSize: number = EmbeddingDefaults.batchSize;

      /**
       * Initialize the OpenAI client
       */
      const initialize = (config: EmbeddingConfig) =>
        Effect.gen(function* () {
          client = new OpenAI({ apiKey: config.apiKey });
          currentModel = config.model ?? EmbeddingDefaults.model;
          batchSize = config.batchSize ?? EmbeddingDefaults.batchSize;

          yield* Effect.logDebug(
            `[EmbeddingService] Initialized with model: ${currentModel}`,
          );
        });

      /**
       * Generate embedding for a single text
       */
      const embedText = (text: string) =>
        Effect.gen(function* () {
          if (!client) {
            return yield* Effect.fail(
              new EmbeddingError({ message: "OpenAI client not initialized" }),
            );
          }

          // Check cache first
          const contentHash = hashContent(text);
          const cached = yield* storage.getCachedEmbedding(contentHash);

          if (cached && cached.model === currentModel) {
            yield* Effect.logDebug(
              `[EmbeddingService] Using cached embedding for hash: ${contentHash.substring(0, 8)}`,
            );
            return cached.embedding;
          }

          // Generate new embedding
          const response = yield* Effect.tryPromise({
            try: () =>
              client!.embeddings.create({
                model: currentModel,
                input: text,
              }),
            catch: (error) =>
              new EmbeddingError({
                message: "Failed to generate embedding",
                cause: error,
              }),
          });

          const embeddingData = response.data[0]?.embedding;
          if (!embeddingData) {
            return yield* Effect.fail(
              new EmbeddingError({ message: "No embedding returned from API" }),
            );
          }

          const embedding = new Float32Array(embeddingData);

          // Cache the embedding
          yield* storage.cacheEmbedding({
            contentHash,
            embedding,
            dimension: embedding.length,
            provider: EmbeddingDefaults.provider,
            model: currentModel,
            updatedAt: new Date(),
          });

          return embedding;
        });

      /**
       * Generate embeddings for multiple texts in batch
       */
      const embedBatch = (texts: string[]) =>
        Effect.gen(function* () {
          if (!client) {
            return yield* Effect.fail(
              new EmbeddingError({ message: "OpenAI client not initialized" }),
            );
          }

          if (texts.length === 0) {
            return [];
          }

          // Check cache for all texts
          const results: (Float32Array | null)[] = new Array(texts.length).fill(
            null,
          );
          const uncachedIndices: number[] = [];
          const uncachedTexts: string[] = [];

          for (let i = 0; i < texts.length; i++) {
            const text = texts[i];
            if (!text) continue;

            const contentHash = hashContent(text);
            const cached = yield* storage.getCachedEmbedding(contentHash);

            if (cached && cached.model === currentModel) {
              results[i] = cached.embedding;
            } else {
              uncachedIndices.push(i);
              uncachedTexts.push(text);
            }
          }

          yield* Effect.logDebug(
            `[EmbeddingService] Cache hit: ${texts.length - uncachedTexts.length}/${texts.length}`,
          );

          // Generate embeddings for uncached texts in batches
          if (uncachedTexts.length > 0) {
            for (let i = 0; i < uncachedTexts.length; i += batchSize) {
              const batchTexts = uncachedTexts.slice(i, i + batchSize);
              const batchIndices = uncachedIndices.slice(i, i + batchSize);

              const response = yield* Effect.tryPromise({
                try: () =>
                  client!.embeddings.create({
                    model: currentModel,
                    input: batchTexts,
                  }),
                catch: (error) =>
                  new EmbeddingError({
                    message: "Failed to generate batch embeddings",
                    cause: error,
                  }),
              });

              // Process results and cache
              for (let j = 0; j < response.data.length; j++) {
                const embeddingData = response.data[j]?.embedding;
                const originalIndex = batchIndices[j];
                const text = batchTexts[j];

                if (embeddingData && originalIndex !== undefined && text) {
                  const embedding = new Float32Array(embeddingData);
                  results[originalIndex] = embedding;

                  // Cache the embedding
                  const contentHash = hashContent(text);
                  yield* storage.cacheEmbedding({
                    contentHash,
                    embedding,
                    dimension: embedding.length,
                    provider: EmbeddingDefaults.provider,
                    model: currentModel,
                    updatedAt: new Date(),
                  });
                }
              }
            }
          }

          return results as Float32Array[];
        });

      /**
       * Generate embeddings for chunks
       */
      const embedChunks = (chunks: MemoryChunk[]) =>
        Effect.gen(function* () {
          const texts = chunks.map((chunk) => chunk.content);
          const embeddings = yield* embedBatch(texts);

          // Update chunks with embeddings
          const updatedChunks = chunks.map((chunk, i) => ({
            ...chunk,
            embedding: embeddings[i] ?? null,
            model: currentModel,
          }));

          return updatedChunks;
        });

      /**
       * Calculate cosine similarity between two embeddings
       */
      const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
        if (a.length !== b.length) {
          return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
          const aVal = a[i] ?? 0;
          const bVal = b[i] ?? 0;
          dotProduct += aVal * bVal;
          normA += aVal * aVal;
          normB += bVal * bVal;
        }

        if (normA === 0 || normB === 0) {
          return 0;
        }

        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
      };

      /**
       * Find similar chunks using vector search
       */
      const searchSimilar = (queryEmbedding: Float32Array, limit: number) =>
        Effect.gen(function* () {
          const allChunks = yield* storage.getAllChunksWithEmbeddings();

          // Calculate similarity for all chunks
          const scored = allChunks
            .map((chunk) => ({
              chunk,
              score: chunk.embedding
                ? cosineSimilarity(queryEmbedding, chunk.embedding)
                : 0,
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);

          return scored;
        });

      return {
        initialize,
        embedText,
        embedBatch,
        embedChunks,
        cosineSimilarity,
        searchSimilar,
      };
    }),
    dependencies: [StorageService.Default],
  },
) {}

/**
 * Live layer for EmbeddingService
 */
export const EmbeddingServiceLive = EmbeddingService.Default;
