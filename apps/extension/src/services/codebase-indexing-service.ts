import { Data, Effect } from "effect";
import vscode from "vscode";
import { embedMany } from "ai";
import { createHash } from "node:crypto";
import { VSCodeService } from "./vs-code.js";
import { ConfigService } from "./config-service.js";
import { RepositoryService, type FileData } from "./repository-service.js";
import { GitService } from "./git-service.js";
import { AIModels } from "./ai-models.js";
import type { IndexingStatus } from "./indexing-status.js";
import { createEmbeddingProvider } from "./ai-provider-factory.js";
import {
  readFileAsStringEffect,
  getWorkspaceRoot,
  getRelativePath,
} from "../lib/vscode-effects.js";
import { estimateTokensFast } from "../utils/token-utils.js";

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
 * TODO: Make this dynamic based on plan level
 */
export const MAX_FILES_TO_INDEX = 1000;

/**
 * Maximum tokens per embedding batch (leave headroom below 8192 limit)
 */
const MAX_EMBEDDING_BATCH_TOKENS = 7000;

/**
 * Maximum tokens per chunk when splitting large files
 */
const MAX_CHUNK_TOKENS = 6000;

/**
 * Maximum number of files to upsert in a single batch (for database efficiency)
 */
const MAX_UPSERT_BATCH_SIZE = 100;

/**
 * File chunk structure for splitting large files
 */
interface FileChunk {
  originalPath: string; // Original file path
  chunkPath: string; // Path with part suffix (e.g., "src/file.ts (part 1/3)")
  content: string; // Chunk content
  partNumber: number; // 1-indexed part number
  totalParts: number; // Total number of parts
  fileType: string; // File type extension
  lastModified: number; // Last modified timestamp
}

/**
 * Module-level shared state for indexing (singleton across service invocations)
 * This ensures the forked daemon and RPC queries share the same state
 */
let indexingState: {
  status: IndexingStatus;
  error?: string;
  progress?: {
    filesIndexed: number;
    totalFiles: number;
  };
} = { status: "idle" };

let cancellationRequested = false;

/**
 * AbortController for cancelling active embedding API requests
 */
let currentAbortController: AbortController | null = null;

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
      const gitService = yield* GitService;

      /**
       * Check for cancellation and interrupt if cancelled
       */
      const checkCancellation = () =>
        Effect.gen(function* () {
          const isCancelled = yield* Effect.sync(() => cancellationRequested);
          if (isCancelled) {
            return yield* Effect.interrupt;
          }
        });

      /**
       * Update indexing progress state
       */
      const updateProgress = (filesIndexed: number, totalFiles: number) =>
        Effect.sync(() => {
          indexingState = {
            status: "in_progress",
            progress: { filesIndexed, totalFiles },
          };
        });

      /**
       * Upsert files with in-memory fallback
       */
      const upsertWithFallback = (
        repositoryId: string | undefined,
        files: IndexedFile[],
      ) =>
        Effect.gen(function* () {
          if (repositoryId) {
            // Split into batches for database efficiency
            for (let i = 0; i < files.length; i += MAX_UPSERT_BATCH_SIZE) {
              const batch = files.slice(i, i + MAX_UPSERT_BATCH_SIZE);
              yield* Effect.all(
                batch.map((indexedFile) =>
                  storeFile(repositoryId, indexedFile).pipe(
                    Effect.catchAll(() =>
                      Effect.sync(() => {
                        inMemoryIndex.set(
                          indexedFile.relativePath,
                          indexedFile,
                        );
                      }),
                    ),
                  ),
                ),
                { concurrency: 10 },
              );
            }
          } else {
            // Store in-memory if no repository context
            for (const indexedFile of files) {
              inMemoryIndex.set(indexedFile.relativePath, indexedFile);
            }
          }
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

          yield* checkCancellation();

          // Always use gateway token for embeddings (OpenAI) - user's stored key is for Anthropic
          const gatewayToken = yield* configService.getAiGatewayToken();
          const provider = createEmbeddingProvider({
            token: gatewayToken,
            isGateway: true,
          });

          // Create new abort controller for this batch
          yield* Effect.sync(() => {
            currentAbortController = new AbortController();
          });

          const embeddings = yield* Effect.tryPromise({
            try: async () => {
              const { embeddings: results } = await embedMany({
                model: provider.embedding(AIModels.openai.embedding),
                values: texts,
                abortSignal: currentAbortController?.signal,
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
            catch: (error) => {
              // Clear abort controller on error (including abort)
              currentAbortController = null;
              const errorMessage =
                error instanceof Error ? error.message : "Unknown error";
              return new EmbeddingError({
                message: errorMessage,
                cause: error,
              });
            },
          }).pipe(
            Effect.tapError((error) =>
              Effect.logDebug(
                `[CodebaseIndexing] Embedding computation failed: ${error instanceof EmbeddingError ? error.message : String(error)}`,
              ),
            ),
          );

          // Clear abort controller after successful completion
          yield* Effect.sync(() => {
            currentAbortController = null;
          });

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
          // Compute embedding for query
          const queryEmbedding = yield* computeEmbedding(query);

          // Try database search if repositoryId is provided
          if (repositoryId) {
            const dbResults = yield* repositoryService
              .searchFiles(repositoryId, queryEmbedding, limit)
              .pipe(Effect.catchAll(() => Effect.succeed([])));

            // If we got results from database, convert and return them
            if (dbResults.length > 0) {
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
          return yield* searchInMemory(queryEmbedding, limit);
        });

      /**
       * Index a single file
       */
      const indexFile = (filePath: string, repositoryId?: string) =>
        Effect.gen(function* () {
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

          // Upsert with fallback
          yield* upsertWithFallback(repositoryId, [indexedFile]);

          return indexedFile;
        });

      /**
       * Split a large file into chunks that fit within token limits
       * Returns array of chunks (or single chunk if file is small enough)
       */
      const splitIntoChunks = (
        relativePath: string,
        content: string,
        fileType: string,
        lastModified: number,
      ): FileChunk[] => {
        const totalTokens = estimateTokensFast(content);

        // If file fits in one chunk, return single chunk
        if (totalTokens <= MAX_CHUNK_TOKENS) {
          return [
            {
              originalPath: relativePath,
              chunkPath: relativePath,
              content,
              partNumber: 1,
              totalParts: 1,
              fileType,
              lastModified,
            },
          ];
        }

        // Split into chunks by lines
        const lines = content.split("\n");
        const estimatedTotalParts = Math.ceil(totalTokens / MAX_CHUNK_TOKENS);
        const chunks: FileChunk[] = [];
        let currentChunkLines: string[] = [];
        let currentChunkTokens = 0;
        let partNumber = 1;

        for (const line of lines) {
          const lineTokens = estimateTokensFast(`${line}\n`);

          // If adding this line would exceed the limit, finalize current chunk
          if (
            currentChunkTokens + lineTokens > MAX_CHUNK_TOKENS &&
            currentChunkLines.length > 0
          ) {
            chunks.push({
              originalPath: relativePath,
              chunkPath: `${relativePath} (part ${partNumber}/${estimatedTotalParts})`,
              content: currentChunkLines.join("\n"),
              partNumber,
              totalParts: estimatedTotalParts,
              fileType,
              lastModified,
            });
            currentChunkLines = [];
            currentChunkTokens = 0;
            partNumber++;
          }

          currentChunkLines.push(line);
          currentChunkTokens += lineTokens;
        }

        // Add final chunk if there are remaining lines
        if (currentChunkLines.length > 0) {
          const actualTotalParts = chunks.length + 1;
          chunks.push({
            originalPath: relativePath,
            chunkPath: `${relativePath} (part ${partNumber}/${actualTotalParts})`,
            content: currentChunkLines.join("\n"),
            partNumber,
            totalParts: actualTotalParts,
            fileType,
            lastModified,
          });
        }

        return chunks;
      };

      /**
       * Batch files by token count to fit within embedding limits
       */
      const batchFilesByTokens = <T extends { content: string }>(
        files: T[],
        maxTokens: number,
      ): T[][] => {
        const batches: T[][] = [];
        let currentBatch: T[] = [];
        let currentBatchTokens = 0;

        for (const file of files) {
          const fileTokens = estimateTokensFast(file.content);

          // If a single file exceeds the limit, put it in its own batch
          if (fileTokens > maxTokens) {
            if (currentBatch.length > 0) {
              batches.push(currentBatch);
              currentBatch = [];
              currentBatchTokens = 0;
            }
            batches.push([file]);
            continue;
          }

          // Check if adding this file would exceed the limit
          if (currentBatchTokens + fileTokens > maxTokens) {
            batches.push(currentBatch);
            currentBatch = [file];
            currentBatchTokens = fileTokens;
          } else {
            currentBatch.push(file);
            currentBatchTokens += fileTokens;
          }
        }

        if (currentBatch.length > 0) {
          batches.push(currentBatch);
        }

        return batches;
      };

      /**
       * Index multiple files in batch (efficient batch embedding with token limits)
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

          // Split large files into chunks
          const fileChunks: FileChunk[] = [];
          for (const file of fileData) {
            const chunks = splitIntoChunks(
              file.relativePath,
              file.content,
              file.fileType,
              file.lastModified,
            );
            fileChunks.push(...chunks);
          }

          // Batch chunks by token count to fit within embedding limits
          const embeddingBatches = batchFilesByTokens(
            fileChunks,
            MAX_EMBEDDING_BATCH_TOKENS,
          );

          yield* Effect.logDebug(
            `[CodebaseIndexing] Processing ${embeddingBatches.length} embedding batches`,
          );

          // Generate embeddings and upsert each batch immediately
          const allIndexedFiles: IndexedFile[] = [];
          for (let i = 0; i < embeddingBatches.length; i++) {
            yield* checkCancellation();

            const batch = embeddingBatches[i];
            yield* Effect.logDebug(
              `[CodebaseIndexing] Processing batch ${i + 1}/${embeddingBatches.length} (${batch.length} chunks)`,
            );

            const texts = batch.map((f) => f.content);
            const batchEmbeddings = yield* computeEmbeddings(texts);

            // Create indexed files for this batch immediately
            const batchIndexedFiles: IndexedFile[] = batch.map(
              (chunk, chunkIdx) => {
                // Find original file path for full file path
                const originalFile = fileData.find(
                  (f) => f.relativePath === chunk.originalPath,
                );
                return {
                  filePath: originalFile?.fileUri.fsPath || chunk.chunkPath,
                  relativePath: chunk.chunkPath,
                  content: chunk.content,
                  embedding: batchEmbeddings[chunkIdx],
                  fileType: chunk.fileType,
                  lastModified: chunk.lastModified,
                };
              },
            );

            // Upsert this batch immediately
            yield* upsertWithFallback(repositoryId, batchIndexedFiles);

            // Accumulate for return value
            allIndexedFiles.push(...batchIndexedFiles);
          }

          return allIndexedFiles;
        });

      /**
       * Index all relevant files in the workspace
       */
      const indexWorkspace = () =>
        Effect.gen(function* () {
          // Reset cancellation flag and update status to in_progress
          yield* Effect.sync(() => {
            cancellationRequested = false;
            indexingState = {
              status: "in_progress",
              progress: { filesIndexed: 0, totalFiles: 0 },
            };
          });
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
          // Try git ls-files first (respects .gitignore), fall back to findFiles
          let files: vscode.Uri[] = [];

          // Helper to check if file matches allowed extensions
          const matchesAllowedExtension = (filePath: string): boolean => {
            const ext = filePath.split(".").pop()?.toLowerCase();
            return (
              ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx"
            );
          };

          // Helper to check if file should be excluded (test files, configs, etc.)
          const shouldExclude = (filePath: string): boolean => {
            const lowerPath = filePath.toLowerCase();
            // Test files
            if (
              lowerPath.includes(".test.") ||
              lowerPath.includes(".spec.") ||
              lowerPath.includes(".cy.") ||
              lowerPath.includes("/__tests__/") ||
              lowerPath.includes("/__mocks__/") ||
              lowerPath.includes("/test/") ||
              lowerPath.includes("/tests/")
            ) {
              return true;
            }
            // Config files
            if (
              lowerPath.includes(".config.") ||
              lowerPath.endsWith("tsconfig.json") ||
              lowerPath.endsWith("package.json") ||
              lowerPath.endsWith("biome.json") ||
              lowerPath.includes("/scripts/") ||
              lowerPath.includes("/tooling/")
            ) {
              return true;
            }
            // Type definitions
            if (lowerPath.endsWith(".d.ts")) {
              return true;
            }
            return false;
          };

          // Try git ls-files first (respects .gitignore automatically)
          const trackedFiles = yield* gitService
            .getTrackedFiles(workspaceRootPath)
            .pipe(Effect.catchAll(() => Effect.succeed([])));

          if (trackedFiles.length > 0) {
            yield* Effect.logDebug(
              `[CodebaseIndexing] Using git ls-files: found ${trackedFiles.length} tracked files`,
            );

            // Filter tracked files by extension and exclude patterns
            const filteredPaths = trackedFiles.filter(
              (filePath) =>
                matchesAllowedExtension(filePath) && !shouldExclude(filePath),
            );

            // Convert to URIs
            files = filteredPaths.map((filePath) =>
              vscode.Uri.joinPath(workspaceRoot, filePath),
            );

            yield* Effect.logDebug(
              `[CodebaseIndexing] Filtered to ${files.length} source files from tracked files`,
            );
          } else {
            // Fallback: use findFiles with fixed brace expansion pattern
            yield* Effect.logDebug(
              "[CodebaseIndexing] Not a git repo or git ls-files failed, using findFiles fallback",
            );

            const excludePattern = `{${INDEXING_EXCLUDE_PATTERNS.join(",")}}`;

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
            files = Array.from(new Set(files.map((f) => f.fsPath))).map(
              (path) => vscode.Uri.file(path),
            );
          }

          const uniqueFiles = files;

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

          // Detect and delete stale files (exist in DB but not in workspace)
          const currentFilePaths = new Set(fileData.map((f) => f.relativePath));
          const existingPaths = Array.from(existingHashes.keys());
          const stalePaths = existingPaths.filter(
            (path) => !currentFilePaths.has(path),
          );

          if (stalePaths.length > 0) {
            yield* Effect.logDebug(
              `[CodebaseIndexing] Deleting ${stalePaths.length} stale files from database`,
            );

            yield* repositoryService
              .deleteFiles(repositoryId, stalePaths)
              .pipe(
                Effect.catchAll((error) =>
                  Effect.logDebug(
                    `[CodebaseIndexing] Failed to delete stale files: ${error.message}`,
                  ),
                ),
              );
          }

          // Separate files that need indexing from unchanged ones
          const filesToEmbed = fileData.filter((f) => f.needsIndexing);
          const unchangedFiles = fileData.filter((f) => !f.needsIndexing);

          // Update progress with actual files to index (not the cap)
          yield* updateProgress(0, filesToEmbed.length);

          let skipped = unchangedFiles.length;
          let indexed = 0;

          // Batch embed all files that need indexing (in chunks if too many)
          if (filesToEmbed.length > 0) {
            const maxEmbeddingBatchSize = 10; // Smaller batches for responsive UI updates

            // Process in chunks if needed
            for (
              let i = 0;
              i < filesToEmbed.length;
              i += maxEmbeddingBatchSize
            ) {
              yield* checkCancellation();

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

              // Update progress: how many of filesToEmbed we've processed
              const filesProcessed = Math.min(
                i + chunk.length,
                filesToEmbed.length,
              );
              yield* updateProgress(filesProcessed, filesToEmbed.length);

              yield* Effect.logDebug(
                `[CodebaseIndexing] Progress: ${indexed} indexed, ${skipped} skipped of ${filesToEmbed.length} files to index`,
              );
            }
          } else {
            // No files need indexing - all unchanged
            yield* updateProgress(0, 0);
          }

          yield* Effect.logDebug(
            `[CodebaseIndexing] Workspace indexing complete: ${indexed} files indexed, ${skipped} unchanged files skipped`,
          );

          // Check if cancelled before marking complete
          const isCancelled = yield* Effect.sync(() => cancellationRequested);
          if (isCancelled) {
            yield* Effect.sync(() => {
              indexingState = { status: "idle" };
            });
            return yield* Effect.interrupt;
          }

          // Update status to complete
          yield* Effect.sync(() => {
            indexingState = {
              status: "complete",
              progress: undefined,
            };
          });
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              // Check if error was due to cancellation
              const isCancelled = yield* Effect.sync(
                () => cancellationRequested,
              );
              if (isCancelled) {
                yield* Effect.sync(() => {
                  indexingState = { status: "idle" };
                });
                return yield* Effect.interrupt;
              }

              const errorMessage =
                error instanceof Error ? error.message : String(error);
              yield* Effect.sync(() => {
                indexingState = {
                  status: "error",
                  error: errorMessage,
                  progress: undefined,
                };
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
          const state = yield* Effect.sync(() => indexingState);
          return state.status;
        });

      /**
       * Get current indexing state (including progress)
       */
      const getState = () =>
        Effect.gen(function* () {
          const state = yield* Effect.sync(() => indexingState);
          return state;
        });

      /**
       * Cancel active indexing operation
       */
      const cancelIndexing = () => cancelIndexingDirect();

      return {
        indexFile,
        indexFiles,
        indexWorkspace,
        semanticSearch,
        getStatus,
        getState,
        cancelIndexing,
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
 * Cancel active indexing operation (standalone function for RPC)
 * Does not require service instantiation - directly manipulates module-level state
 */
export const cancelIndexingDirect = () =>
  Effect.gen(function* () {
    yield* Effect.sync(() => {
      cancellationRequested = true;
      indexingState = { status: "idle" };
      // Abort any active embedding request
      if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
      }
    });
    yield* Effect.logDebug("[CodebaseIndexing] Indexing cancelled");
  });

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
