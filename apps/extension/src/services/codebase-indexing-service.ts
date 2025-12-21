import { Data, Effect, Ref } from "effect";
import vscode from "vscode";
import { embed } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "crypto";
import { VSCodeService } from "./vs-code.js";
import { ConfigService } from "./config-service.js";
import { RepositoryService, type FileData } from "./repository-service.js";
import { AIModels } from "./ai-models.js";
import type { IndexingStatus } from "./indexing-status.js";
import {
  readFileAsStringEffect,
  getWorkspaceRoot,
  getRelativePath,
} from "../lib/vscode-effects.js";

/**
 * File metadata stored in the index
 */
export interface IndexedFile {
  filePath: string;
  relativePath: string;
  content: string;
  embedding: number[];
  fileType: string;
  lastModified: number;
}

/**
 * Search result from semantic search (compatible with existing interface)
 */
export interface SearchResult {
  filePath: string;
  relativePath: string;
  content: string;
  similarity: number;
  fileType: string;
}

class EmbeddingError extends Data.TaggedError("EmbeddingError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * In-memory index for when database is not available (fallback)
 */
const inMemoryIndex = new Map<string, IndexedFile>();

/**
 * File patterns to include for indexing (source files only)
 * Components, services, utils, hooks, etc.
 */
export const INDEXING_INCLUDE_PATTERNS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
] as const;

/**
 * File patterns to exclude from indexing
 * Excludes test files, configs, build artifacts, and type definitions
 */
export const INDEXING_EXCLUDE_PATTERNS = [
  // Build artifacts and dependencies
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.next/**",
  "**/out/**",
  "**/coverage/**",
  // Test files (we generate tests, not index them)
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.cy.ts",
  "**/*.cy.tsx",
  "**/__tests__/**",
  "**/__mocks__/**",
  "**/test/**",
  "**/tests/**",
  // Config files
  "**/*.config.ts",
  "**/*.config.js",
  "**/*.config.mjs",
  "**/vite.config.*",
  "**/vitest.config.*",
  "**/jest.config.*",
  "**/tailwind.config.*",
  "**/postcss.config.*",
  "**/tsconfig.json",
  "**/package.json",
  "**/biome.json",
  // Type definitions
  "**/*.d.ts",
  // Scripts and tooling
  "**/scripts/**",
  "**/tooling/**",
] as const;

/**
 * Service for indexing codebase files with embeddings and semantic search
 * Uses OpenAI embeddings and Supabase Vector Buckets for storage (or in-memory fallback)
 */
export class CodebaseIndexingService extends Effect.Service<CodebaseIndexingService>()(
  "CodebaseIndexingService",
  {
    effect: Effect.gen(function* () {
      const vscodeService = yield* VSCodeService;
      const configService = yield* ConfigService;
      const repositoryService = yield* RepositoryService;

      /**
       * In-memory indexing state tracker using Effect Ref
       */
      const indexingStateRef = yield* Ref.make<{
        status: IndexingStatus;
        error?: string;
      }>({
        status: "idle",
      });

      /**
       * Compute embedding for text using AI SDK with gateway token
       */
      const computeEmbedding = (text: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[CodebaseIndexing] Computing embedding for text (${text.length} chars)`,
          );

          const gatewayToken = yield* configService.getAiApiKey();

          const embedding = yield* Effect.tryPromise({
            try: async () => {
              // Use AI SDK with OpenAI provider via gateway
              const openai = createOpenAI({ apiKey: gatewayToken });

              const { embedding: embeddingResult } = await embed({
                model: openai.embedding(AIModels.openai.embedding),
                value: text,
              });

              if (!embeddingResult || embeddingResult.length === 0) {
                throw new Error("No embedding returned from AI SDK");
              }

              return embeddingResult;
            },
            catch: (error) =>
              new EmbeddingError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[CodebaseIndexing] Embedding computed (${embedding.length} dimensions)`,
          );
          return embedding;
        });

      /**
       * Compute content hash for change detection
       */
      const computeContentHash = (content: string): string => {
        return createHash("md5").update(content).digest("hex");
      };

      /**
       * Store file in database using RepositoryService
       */
      const storeFile = (repositoryId: string, file: IndexedFile) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[CodebaseIndexing] Storing file in database: ${file.relativePath}`,
          );

          const contentHash = computeContentHash(file.content);

          const fileData: FileData = {
            relativePath: file.relativePath,
            content: file.content,
            embedding: file.embedding,
            fileType: file.fileType,
            contentHash,
          };

          yield* repositoryService.upsertFile(repositoryId, fileData).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[CodebaseIndexing] Failed to store in database (will use in-memory): ${error.message}`,
                );
                // Don't fail - fall back to in-memory
              }),
            ),
          );

          yield* Effect.logDebug(
            `[CodebaseIndexing] File stored in database: ${file.relativePath}`,
          );
        });

      /**
       * Search for similar files using semantic search
       */
      const semanticSearch = (
        query: string,
        limit: number = 10,
        repositoryId?: string,
      ) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[CodebaseIndexing] Semantic search: "${query}" (limit: ${limit})`,
          );

          // Compute embedding for query
          const queryEmbedding = yield* computeEmbedding(query);

          // Try database search if repositoryId is provided
          if (repositoryId) {
            const dbResults = yield* repositoryService
              .searchFiles(repositoryId, queryEmbedding, limit)
              .pipe(
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[CodebaseIndexing] Database search failed (will use in-memory): ${error.message}`,
                    );
                    return [];
                  }),
                ),
              );

            // If we got results from database, convert and return them
            if (dbResults.length > 0) {
              yield* Effect.logDebug(
                `[CodebaseIndexing] Found ${dbResults.length} results from database`,
              );
              return dbResults.map((result) => ({
                filePath: result.relativePath, // Will need full path in real implementation
                relativePath: result.relativePath,
                content: result.content,
                similarity: result.similarity,
                fileType: result.fileType,
              }));
            }
          }

          // Fallback: search in-memory index
          yield* Effect.logDebug("[CodebaseIndexing] Using in-memory search");
          return yield* searchInMemory(queryEmbedding, limit);
        });

      /**
       * Index a single file
       */
      const indexFile = (filePath: string, repositoryId?: string) =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[CodebaseIndexing] Indexing file: ${filePath}`,
          );

          const workspaceRoot = yield* getWorkspaceRoot();
          const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);

          // Read file content
          const content = yield* readFileAsStringEffect(fileUri);
          const relativePath = yield* getRelativePath(fileUri);

          // Get file stats
          const stats = yield* Effect.tryPromise({
            try: () => vscodeService.workspace.fs.stat(fileUri),
            catch: () => new Error("Failed to stat file"),
          });

          // Determine file type
          const fileType = filePath.split(".").pop() || "unknown";

          // Compute embedding
          const embedding = yield* computeEmbedding(content);

          const indexedFile: IndexedFile = {
            filePath: fileUri.fsPath,
            relativePath,
            content,
            embedding,
            fileType,
            lastModified: stats.mtime,
          };

          // Try to store in database if repositoryId is provided
          if (repositoryId) {
            yield* storeFile(repositoryId, indexedFile).pipe(
              Effect.catchAll(() =>
                Effect.gen(function* () {
                  // Store in-memory as fallback
                  inMemoryIndex.set(indexedFile.relativePath, indexedFile);
                  yield* Effect.logDebug(
                    `[CodebaseIndexing] Stored in-memory: ${relativePath}`,
                  );
                }),
              ),
            );
          } else {
            // Store in-memory if no repository context
            inMemoryIndex.set(indexedFile.relativePath, indexedFile);
            yield* Effect.logDebug(
              `[CodebaseIndexing] Stored in-memory: ${relativePath}`,
            );
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Indexed file: ${relativePath}`,
          );

          return indexedFile;
        });

      /**
       * Index all relevant files in the workspace
       */
      const indexWorkspace = () =>
        Effect.gen(function* () {
          // Update status to in_progress
          yield* Ref.set(indexingStateRef, { status: "in_progress" });
          yield* Effect.logDebug(
            "[CodebaseIndexing] Starting workspace indexing",
          );

          const workspaceRoot = yield* getWorkspaceRoot();
          const workspaceRootPath = workspaceRoot.fsPath;

          // Get or create repository
          const userId = yield* repositoryService.getUserId();
          const workspaceName =
            workspaceRootPath.split("/").pop() || "workspace";

          // Upsert repository
          const repository = yield* repositoryService.upsertRepository(
            userId,
            workspaceName,
            workspaceRootPath,
          );
          const repositoryId = repository.id;

          yield* Effect.logDebug(
            `[CodebaseIndexing] Using repository: ${repositoryId}`,
          );

          // Find source files relevant for test generation
          const files: vscode.Uri[] = [];
          const excludePattern = INDEXING_EXCLUDE_PATTERNS.join(",");

          for (const pattern of INDEXING_INCLUDE_PATTERNS) {
            const foundFiles = yield* Effect.tryPromise({
              try: () =>
                vscodeService.workspace.findFiles(
                  pattern,
                  excludePattern,
                  1000, // Limit to 1000 files
                ),
              catch: () => new Error("Failed to find files"),
            });

            files.push(...foundFiles);
          }

          // Remove duplicates
          const uniqueFiles = Array.from(
            new Set(files.map((f) => f.fsPath)),
          ).map((path) => vscode.Uri.file(path));

          yield* Effect.logDebug(
            `[CodebaseIndexing] Found ${uniqueFiles.length} files to check`,
          );

          // Single batch query - get all existing file hashes for O(1) lookups
          const existingHashes = yield* repositoryService
            .getFileHashes(repositoryId)
            .pipe(
              Effect.catchAll(() =>
                Effect.gen(function* () {
                  yield* Effect.logDebug(
                    "[CodebaseIndexing] Failed to fetch existing hashes, will index all files",
                  );
                  return new Map<string, string>();
                }),
              ),
            );

          yield* Effect.logDebug(
            `[CodebaseIndexing] Retrieved ${existingHashes.size} existing file hashes`,
          );

          // Index files in batches, skipping unchanged files
          const batchSize = 10;
          let indexed = 0;
          let skipped = 0;

          for (let i = 0; i < uniqueFiles.length; i += batchSize) {
            const batch = uniqueFiles.slice(i, i + batchSize);

            const results = yield* Effect.all(
              batch.map((fileUri) =>
                Effect.gen(function* () {
                  const relativePath = yield* getRelativePath(fileUri);

                  // Read file content and compute hash
                  const content = yield* readFileAsStringEffect(fileUri);
                  const contentHash = computeContentHash(content);

                  // O(1) lookup in Map - skip if unchanged
                  const existingHash = existingHashes.get(relativePath);
                  if (existingHash === contentHash) {
                    yield* Effect.logDebug(
                      `[CodebaseIndexing] Skipping unchanged: ${relativePath}`,
                    );
                    return { indexed: false };
                  }

                  // File is new or changed - compute embedding and store
                  return yield* indexFile(relativePath, repositoryId).pipe(
                    Effect.map(() => ({ indexed: true })),
                    Effect.catchAll((error) =>
                      Effect.gen(function* () {
                        yield* Effect.logDebug(
                          `[CodebaseIndexing] Failed to index ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
                        );
                        return { indexed: false };
                      }),
                    ),
                  );
                }).pipe(
                  Effect.catchAll(() => Effect.succeed({ indexed: false })),
                ),
              ),
              { concurrency: batchSize },
            );

            // Count indexed vs skipped
            for (const result of results) {
              if (result.indexed) {
                indexed++;
              } else {
                skipped++;
              }
            }

            yield* Effect.logDebug(
              `[CodebaseIndexing] Progress: ${indexed} indexed, ${skipped} skipped of ${uniqueFiles.length} files`,
            );
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Workspace indexing complete: ${indexed} files indexed, ${skipped} unchanged files skipped`,
          );

          // Update status to complete
          yield* Ref.set(indexingStateRef, { status: "complete" });
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              yield* Ref.set(indexingStateRef, {
                status: "error",
                error: errorMessage,
              });
              yield* Effect.logDebug(
                `[CodebaseIndexing] Indexing failed: ${errorMessage}`,
              );
              return yield* Effect.fail(error);
            }),
          ),
        );

      /**
       * Search in-memory index using cosine similarity
       */
      const searchInMemory = (
        queryEmbedding: number[],
        limit: number,
      ): Effect.Effect<SearchResult[]> =>
        Effect.gen(function* () {
          yield* Effect.logDebug(
            `[CodebaseIndexing] Searching in-memory index (${inMemoryIndex.size} files)`,
          );

          const results: SearchResult[] = [];

          for (const [relativePath, indexedFile] of inMemoryIndex.entries()) {
            const similarity = cosineSimilarity(
              queryEmbedding,
              indexedFile.embedding,
            );

            results.push({
              filePath: indexedFile.filePath,
              relativePath,
              content: indexedFile.content,
              similarity,
              fileType: indexedFile.fileType,
            });
          }

          // Sort by similarity and return top results
          return results
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);
        });

      /**
       * Get current indexing status
       */
      const getStatus = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(indexingStateRef);
          return state.status;
        });

      return {
        indexFile,
        indexWorkspace,
        semanticSearch,
        getStatus,
      };
    }),
    dependencies: [
      VSCodeService.Default,
      ConfigService.Default,
      RepositoryService.Default,
    ],
  },
) {}

/**
 * Helper function to compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}
