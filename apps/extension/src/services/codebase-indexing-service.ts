import { Data, Effect, Ref } from "effect";
import vscode from "vscode";
import { embedMany } from "ai";
import { createHash } from "crypto";
import { VSCodeService } from "./vs-code.js";
import { ConfigService } from "./config-service.js";
import { RepositoryService, type FileData } from "./repository-service.js";
import { AIModels } from "./ai-models.js";
import type { IndexingStatus } from "./indexing-status.js";
import { createEmbeddingProvider } from "./ai-provider-factory.js";
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
 * Maximum number of files to index (for testing - set to a small number)
 * Set to null or a large number to index all files
 */
export const MAX_FILES_TO_INDEX = 5;

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
       * Compute embeddings for multiple texts using AI SDK (batch processing)
       * Uses gateway provider if gateway token is available, otherwise direct provider
       */
      const computeEmbeddings = (texts: string[]) =>
        Effect.gen(function* () {
          if (texts.length === 0) {
            return [];
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Computing embeddings for ${texts.length} texts`,
          );

          // Always use gateway token for embeddings (OpenAI) - user's stored key is for Anthropic
          const gatewayToken = yield* configService.getAiGatewayToken();
          const provider = createEmbeddingProvider({
            token: gatewayToken,
            isGateway: true,
          });

          const embeddings = yield* Effect.tryPromise({
            try: async () => {
              const { embeddings: results } = await embedMany({
                model: provider.embedding(AIModels.openai.embedding),
                values: texts,
              });

              if (!results || results.length === 0) {
                throw new Error("No embeddings returned from AI SDK");
              }

              if (results.length !== texts.length) {
                throw new Error(
                  `Expected ${texts.length} embeddings but got ${results.length}`,
                );
              }

              return results;
            },
            catch: (error) =>
              new EmbeddingError({
                message:
                  error instanceof Error ? error.message : "Unknown error",
                cause: error,
              }),
          });

          yield* Effect.logDebug(
            `[CodebaseIndexing] Computed ${embeddings.length} embeddings`,
          );
          return embeddings;
        });

      /**
       * Compute embedding for a single text (wrapper for backward compatibility)
       */
      const computeEmbedding = (text: string) =>
        Effect.gen(function* () {
          const embeddings = yield* computeEmbeddings([text]);
          return embeddings[0];
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
       * Index multiple files in batch (efficient batch embedding)
       */
      const indexFiles = (filePaths: string[], repositoryId?: string) =>
        Effect.gen(function* () {
          if (filePaths.length === 0) {
            return [];
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Batch indexing ${filePaths.length} files`,
          );

          const workspaceRoot = yield* getWorkspaceRoot();

          // Read all files in parallel
          const fileData = yield* Effect.all(
            filePaths.map((filePath) =>
              Effect.gen(function* () {
                const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);
                const content = yield* readFileAsStringEffect(fileUri);
                const relativePath = yield* getRelativePath(fileUri);

                // Get file stats
                const stats = yield* Effect.tryPromise({
                  try: () => vscodeService.workspace.fs.stat(fileUri),
                  catch: () => new Error("Failed to stat file"),
                });

                // Determine file type
                const fileType = filePath.split(".").pop() || "unknown";

                return {
                  filePath,
                  relativePath,
                  content,
                  fileUri,
                  fileType,
                  lastModified: stats.mtime,
                };
              }),
            ),
            { concurrency: 10 },
          );

          // Batch embed all texts at once
          const texts = fileData.map((f) => f.content);
          const embeddings = yield* computeEmbeddings(texts);

          // Create indexed files with embeddings
          const indexedFiles: IndexedFile[] = fileData.map((file, idx) => ({
            filePath: file.fileUri.fsPath,
            relativePath: file.relativePath,
            content: file.content,
            embedding: embeddings[idx],
            fileType: file.fileType,
            lastModified: file.lastModified,
          }));

          // Store all files (in parallel)
          if (repositoryId) {
            yield* Effect.all(
              indexedFiles.map((indexedFile) =>
                storeFile(repositoryId, indexedFile).pipe(
                  Effect.catchAll(() =>
                    Effect.gen(function* () {
                      // Store in-memory as fallback
                      inMemoryIndex.set(indexedFile.relativePath, indexedFile);
                      yield* Effect.logDebug(
                        `[CodebaseIndexing] Stored in-memory: ${indexedFile.relativePath}`,
                      );
                    }),
                  ),
                ),
              ),
              { concurrency: 10 },
            );
          } else {
            // Store in-memory if no repository context
            for (const indexedFile of indexedFiles) {
              inMemoryIndex.set(indexedFile.relativePath, indexedFile);
              yield* Effect.logDebug(
                `[CodebaseIndexing] Stored in-memory: ${indexedFile.relativePath}`,
              );
            }
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Batch indexed ${indexedFiles.length} files`,
          );

          return indexedFiles;
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
          const organizationId = yield* repositoryService.getOrganizationId();
          const workspaceName =
            workspaceRootPath.split("/").pop() || "workspace";

          // Upsert repository (scoped to organization if available)
          const repository = yield* repositoryService.upsertRepository(
            userId,
            workspaceName,
            workspaceRootPath,
            organizationId,
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

          // Limit files for testing
          const filesToIndex = MAX_FILES_TO_INDEX
            ? uniqueFiles.slice(0, MAX_FILES_TO_INDEX)
            : uniqueFiles;

          yield* Effect.logDebug(
            `[CodebaseIndexing] Found ${uniqueFiles.length} files, limiting to ${filesToIndex.length} for indexing`,
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

          // Read all files and identify which need indexing
          const readConcurrency = 20;
          const fileData = yield* Effect.all(
            filesToIndex.map((fileUri) =>
              Effect.gen(function* () {
                const relativePath = yield* getRelativePath(fileUri);
                const content = yield* readFileAsStringEffect(fileUri);
                const contentHash = computeContentHash(content);
                const existingHash = existingHashes.get(relativePath);

                return {
                  fileUri,
                  relativePath,
                  content,
                  contentHash,
                  needsIndexing: existingHash !== contentHash,
                };
              }),
            ),
            { concurrency: readConcurrency },
          );

          // Separate files that need indexing from unchanged ones
          const filesToEmbed = fileData.filter((f) => f.needsIndexing);
          const unchangedFiles = fileData.filter((f) => !f.needsIndexing);

          let skipped = unchangedFiles.length;
          let indexed = 0;

          // Log skipped files
          for (const file of unchangedFiles) {
            yield* Effect.logDebug(
              `[CodebaseIndexing] Skipping unchanged: ${file.relativePath}`,
            );
          }

          // Batch embed all files that need indexing (in chunks if too many)
          if (filesToEmbed.length > 0) {
            const maxEmbeddingBatchSize = 100; // Reasonable limit to avoid timeouts

            // Process in chunks if needed
            for (
              let i = 0;
              i < filesToEmbed.length;
              i += maxEmbeddingBatchSize
            ) {
              const chunk = filesToEmbed.slice(i, i + maxEmbeddingBatchSize);
              const chunkPaths = chunk.map((f) => f.relativePath);

              yield* Effect.logDebug(
                `[CodebaseIndexing] Processing chunk ${Math.floor(i / maxEmbeddingBatchSize) + 1} of ${Math.ceil(filesToEmbed.length / maxEmbeddingBatchSize)} (${chunk.length} files)`,
              );

              const indexedFiles = yield* indexFiles(
                chunkPaths,
                repositoryId,
              ).pipe(
                Effect.catchAll((error) =>
                  Effect.gen(function* () {
                    yield* Effect.logDebug(
                      `[CodebaseIndexing] Batch indexing failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                    return [];
                  }),
                ),
              );

              indexed += indexedFiles.length;
              skipped += chunk.length - indexedFiles.length;

              yield* Effect.logDebug(
                `[CodebaseIndexing] Progress: ${indexed} indexed, ${skipped} skipped of ${filesToIndex.length} files`,
              );
            }
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
        indexFiles,
        indexWorkspace,
        semanticSearch,
        getStatus,
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use CodebaseIndexingService.Default in tests with mocked deps.
 */
/**
 * CodebaseIndexingService depends on VSCodeService (context-specific), ConfigService, RepositoryService.
 * All have context-specific deps in their chain.
 * Use CodebaseIndexingService.Default directly - dependencies provided at composition site.
 */
export const CodebaseIndexingServiceLive = CodebaseIndexingService.Default;

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
