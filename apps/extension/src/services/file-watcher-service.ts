import { Effect, Ref, Runtime, Layer, Schedule, Fiber, pipe } from "effect";
import * as vscode from "vscode";
import { IndexingConfig } from "../constants.js";
import {
  INDEXING_INCLUDE_PATTERNS,
  INDEXING_EXCLUDE_PATTERNS,
  CodebaseIndexingService,
} from "./codebase-indexing-service.js";
import { ConfigService } from "./config-service.js";
import { RepositoryService } from "./repository-service.js";
import { VSCodeService, type SecretStorageService } from "./vs-code.js";
import { ApiKeyService } from "./api-key-service.js";
import { getRelativePath, getWorkspaceRoot } from "../lib/vscode-effects.js";

/**
 * Pending file entry with debounce tracking
 */
interface PendingFile {
  relativePath: string;
  uri: vscode.Uri;
  lastChanged: number;
}

/**
 * File watcher state managed via Effect Ref
 */
interface FileWatcherState {
  pendingFiles: Map<string, PendingFile>;
  isRunning: boolean;
}

/**
 * Check if file should be excluded based on exclude patterns
 */
const shouldExcludeFile = (uri: vscode.Uri): boolean => {
  const relativePath = vscode.workspace.asRelativePath(uri, false);

  for (const pattern of INDEXING_EXCLUDE_PATTERNS) {
    // Convert glob pattern to regex for matching
    const regexPattern = pattern
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*")
      .replace(/\./g, "\\.");

    if (new RegExp(`^${regexPattern}$`).test(relativePath)) {
      return true;
    }
  }

  return false;
};

/**
 * Check if file matches include patterns
 */
const matchesIncludePattern = (uri: vscode.Uri): boolean => {
  const relativePath = vscode.workspace.asRelativePath(uri, false);
  const extension = relativePath.split(".").pop()?.toLowerCase();

  // Check common extensions from include patterns
  const includedExtensions = ["ts", "tsx", "js", "jsx"];
  return extension !== undefined && includedExtensions.includes(extension);
};

/**
 * Service for watching file changes and triggering incremental indexing
 * Uses Effect-TS for all business logic with debouncing to avoid spamming during active editing
 */
export class FileWatcherService extends Effect.Service<FileWatcherService>()(
  "FileWatcherService",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;
      const repositoryService = yield* RepositoryService;
      const indexingService = yield* CodebaseIndexingService;

      /**
       * State ref for pending files and running status
       */
      const stateRef = yield* Ref.make<FileWatcherState>({
        pendingFiles: new Map(),
        isRunning: false,
      });

      /**
       * Fiber ref for the batch processor
       */
      const batchProcessorFiberRef = yield* Ref.make<Fiber.RuntimeFiber<
        void,
        never
      > | null>(null);

      /**
       * Disposables ref for cleanup
       */
      const disposablesRef = yield* Ref.make<vscode.Disposable[]>([]);

      /**
       * Add file to pending queue with debounce timestamp
       */
      const addToPendingQueue = (uri: vscode.Uri) =>
        Effect.gen(function* () {
          const relativePath = vscode.workspace.asRelativePath(uri, false);
          const now = Date.now();

          yield* Ref.update(stateRef, (state) => ({
            ...state,
            pendingFiles: new Map(state.pendingFiles).set(relativePath, {
              relativePath,
              uri,
              lastChanged: now,
            }),
          }));

          yield* Effect.logDebug(
            `[FileWatcher] Added to pending queue: ${relativePath}`,
          );
        });

      /**
       * Handle file change event
       */
      const onFileChanged = (uri: vscode.Uri) =>
        Effect.gen(function* () {
          // Skip if file matches exclude patterns (pure function, no Effect needed)
          if (shouldExcludeFile(uri)) {
            return;
          }

          yield* addToPendingQueue(uri);
        });

      /**
       * Handle document save event
       */
      const onDocumentSaved = (document: vscode.TextDocument) =>
        Effect.gen(function* () {
          const uri = document.uri;

          // Only handle file scheme
          if (uri.scheme !== "file") {
            return;
          }

          // Skip if file matches exclude patterns
          if (shouldExcludeFile(uri)) {
            return;
          }

          // Check if file matches include patterns
          if (!matchesIncludePattern(uri)) {
            return;
          }

          yield* addToPendingQueue(uri);
        });

      /**
       * Index a single file
       */
      const indexPendingFile = (
        pendingFile: PendingFile,
        repositoryId: string,
      ) =>
        Effect.gen(function* () {
          const relativePath = yield* getRelativePath(pendingFile.uri);
          yield* Effect.logDebug(
            `[FileWatcher] Indexing changed file: ${relativePath}`,
          );

          yield* indexingService
            .indexFile(relativePath, repositoryId)
            .pipe(
              Effect.catchAll((error) =>
                Effect.logDebug(
                  `[FileWatcher] Failed to index ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
                ),
              ),
            );
        });

      /**
       * Process files that have passed their debounce window
       */
      const processPendingFiles = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          const now = Date.now();
          const filesToProcess: PendingFile[] = [];
          const remainingFiles = new Map<string, PendingFile>();

          // Partition files: ready to process vs still debouncing
          for (const [relativePath, pendingFile] of state.pendingFiles) {
            const timeSinceChange = now - pendingFile.lastChanged;

            if (timeSinceChange >= IndexingConfig.debounceMs) {
              filesToProcess.push(pendingFile);
            } else {
              remainingFiles.set(relativePath, pendingFile);
            }
          }

          // Update state with remaining files
          yield* Ref.update(stateRef, (s) => ({
            ...s,
            pendingFiles: remainingFiles,
          }));

          if (filesToProcess.length === 0) {
            return;
          }

          yield* Effect.logDebug(
            `[FileWatcher] Processing ${filesToProcess.length} files after debounce`,
          );

          // Check authentication first
          const authToken = yield* configService.getAuthToken();

          if (!authToken) {
            yield* Effect.logDebug(
              "[FileWatcher] Skipping indexing - user not authenticated",
            );
            return;
          }

          // Get repository context
          const workspaceRoot = yield* getWorkspaceRoot();
          const userId = yield* repositoryService.getUserId();
          const organizationId = yield* repositoryService.getOrganizationId();
          const workspaceName =
            workspaceRoot.fsPath.split("/").pop() || "workspace";

          const repository = yield* repositoryService.upsertRepository(
            userId,
            workspaceName,
            workspaceRoot.fsPath,
            organizationId,
          );

          // Get relative paths for batch indexing
          const relativePaths = yield* Effect.all(
            filesToProcess.map((pendingFile) =>
              getRelativePath(pendingFile.uri),
            ),
          );

          // Batch index all files at once
          yield* indexingService.indexFiles(relativePaths, repository.id).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.logDebug(
                  `[FileWatcher] Batch indexing failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                // Fall back to individual indexing
                yield* Effect.logDebug(
                  "[FileWatcher] Falling back to individual file indexing",
                );
                yield* Effect.forEach(
                  filesToProcess,
                  (pendingFile) => indexPendingFile(pendingFile, repository.id),
                  { concurrency: 3 },
                );
              }),
            ),
          );

          yield* Effect.logDebug(
            `[FileWatcher] Finished processing ${filesToProcess.length} files`,
          );
        }).pipe(
          Effect.catchAll((error) =>
            Effect.logDebug(
              `[FileWatcher] Error processing files: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
        );

      /**
       * Create file system watchers
       */
      const createWatchers = () =>
        Effect.sync(() => {
          const disposables: vscode.Disposable[] = [];

          // Create file system watchers for each include pattern
          for (const pattern of INDEXING_INCLUDE_PATTERNS) {
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            // Watch for changes - run effects in background
            watcher.onDidChange((uri) => {
              pipe(
                onFileChanged(uri),
                Runtime.runPromise(Runtime.defaultRuntime),
              ).catch(() => {
                // Errors logged in effect
              });
            });

            watcher.onDidCreate((uri) => {
              pipe(
                onFileChanged(uri),
                Runtime.runPromise(Runtime.defaultRuntime),
              ).catch(() => {
                // Errors logged in effect
              });
            });

            disposables.push(watcher);
          }

          // Also watch for document saves (more reliable for active editing)
          const saveDisposable = vscode.workspace.onDidSaveTextDocument(
            (document) => {
              pipe(
                onDocumentSaved(document),
                Runtime.runPromise(Runtime.defaultRuntime),
              ).catch(() => {
                // Errors logged in effect
              });
            },
          );
          disposables.push(saveDisposable);

          return disposables;
        });

      /**
       * Start watching for file changes
       */
      const start = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);

          if (state.isRunning) {
            yield* Effect.logDebug(
              "[FileWatcher] Already running, skipping start",
            );
            return;
          }

          yield* Effect.logDebug(
            "[FileWatcher] Starting file watcher service...",
          );

          // Update running state
          yield* Ref.update(stateRef, (s) => ({ ...s, isRunning: true }));

          // Create and store watchers
          const watchers = yield* createWatchers();
          yield* Ref.set(disposablesRef, watchers);

          // Start the batch processor in a fiber
          const batchProcessor = pipe(
            processPendingFiles(),
            Effect.repeat(
              Schedule.spaced(`${IndexingConfig.batchIntervalMs} millis`),
            ),
            Effect.asVoid,
            Effect.catchAll(() => Effect.void),
          );

          const fiber = yield* Effect.fork(batchProcessor);
          yield* Ref.set(batchProcessorFiberRef, fiber);

          yield* Effect.logDebug(
            `[FileWatcher] Started watching ${INDEXING_INCLUDE_PATTERNS.length} patterns with ${IndexingConfig.debounceMs}ms debounce`,
          );
        });

      /**
       * Stop watching for file changes
       */
      const stop = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);

          if (!state.isRunning) {
            return;
          }

          yield* Effect.logDebug(
            "[FileWatcher] Stopping file watcher service...",
          );

          // Stop batch processor fiber
          const fiber = yield* Ref.get(batchProcessorFiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(batchProcessorFiberRef, null);
          }

          // Dispose watchers
          const disposables = yield* Ref.get(disposablesRef);
          yield* Effect.sync(() => {
            for (const disposable of disposables) {
              disposable.dispose();
            }
          });
          yield* Ref.set(disposablesRef, []);

          // Clear state
          yield* Ref.update(stateRef, () => ({
            pendingFiles: new Map(),
            isRunning: false,
          }));

          yield* Effect.logDebug("[FileWatcher] Stopped file watcher service");
        });

      /**
       * Get the current count of pending files
       */
      const getPendingFileCount = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          return state.pendingFiles.size;
        });

      /**
       * Check if the service is running
       */
      const isRunning = () =>
        Effect.gen(function* () {
          const state = yield* Ref.get(stateRef);
          return state.isRunning;
        });

      return {
        start,
        stop,
        getPendingFileCount,
        isRunning,
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use FileWatcherService.Default in tests with mocked deps.

 * FileWatcherService depends on VSCodeService (context-specific), ConfigService, etc.
 * All have context-specific deps in their chain.
 * Use FileWatcherService.Default directly - dependencies provided at composition site.
 */
export const FileWatcherServiceLive = FileWatcherService.Default;

/**
 * Wrapper class for VS Code Disposable integration
 * Bridges the Effect-based FileWatcherService with VS Code's disposal pattern
 */
export class FileWatcherDisposable implements vscode.Disposable {
  private serviceLayer: Layer.Layer<
    | FileWatcherService
    | CodebaseIndexingService
    | ConfigService
    | RepositoryService
    | VSCodeService
    | ApiKeyService
    | SecretStorageService
  > | null = null;

  private outputChannel: vscode.OutputChannel | null = null;

  /**
   * Set the service layer for Effect programs
   */
  setServiceLayer(
    layer: Layer.Layer<
      | FileWatcherService
      | CodebaseIndexingService
      | ConfigService
      | RepositoryService
      | VSCodeService
      | ApiKeyService
      | SecretStorageService
    >,
  ): void {
    this.serviceLayer = layer;
  }

  /**
   * Set output channel for logging
   */
  setOutputChannel(outputChannel: vscode.OutputChannel): void {
    this.outputChannel = outputChannel;
  }

  /**
   * Start the file watcher service
   */
  async start(): Promise<void> {
    if (!this.serviceLayer) {
      this.outputChannel?.appendLine(
        "[FileWatcher] Cannot start - service layer not set",
      );
      return;
    }

    const layer = this.serviceLayer;
    const outputChannel = this.outputChannel;

    await pipe(
      Effect.gen(function* () {
        const service = yield* FileWatcherService;
        yield* service.start();
      }),
      Effect.provide(layer),
      Effect.catchAll((error: unknown) =>
        Effect.sync(() => {
          outputChannel?.appendLine(
            `[FileWatcher] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
          );
        }),
      ),
      Runtime.runPromise(Runtime.defaultRuntime),
    );
  }

  /**
   * Get the current count of pending files
   */
  async getPendingFileCount(): Promise<number> {
    if (!this.serviceLayer) {
      return 0;
    }

    const layer = this.serviceLayer;

    return pipe(
      Effect.gen(function* () {
        const service = yield* FileWatcherService;
        return yield* service.getPendingFileCount();
      }),
      Effect.provide(layer),
      Effect.catchAll(() => Effect.succeed(0)),
      Runtime.runPromise(Runtime.defaultRuntime),
    );
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (!this.serviceLayer) {
      return;
    }

    const layer = this.serviceLayer;

    pipe(
      Effect.gen(function* () {
        const service = yield* FileWatcherService;
        yield* service.stop();
      }),
      Effect.provide(layer),
      Effect.catchAll(() => Effect.void),
      Runtime.runPromise(Runtime.defaultRuntime),
    ).catch(() => {
      // Errors logged in effect
    });
  }
}
