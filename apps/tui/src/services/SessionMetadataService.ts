/**
 * SessionMetadataService
 * Manages session metadata including Linear project/task associations
 * Stores metadata in ~/.clive/session-metadata.json
 *
 * Built with Effect-TS for proper error handling
 */

import { Context, Data, Effect, Layer } from 'effect';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export interface SessionMetadata {
  sessionId: string;
  linearProjectId?: string;
  linearProjectIdentifier?: string; // e.g., "CLIVE-123"
  linearTaskId?: string;
  linearTaskIdentifier?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Error when reading or writing session metadata
 */
export class SessionMetadataError extends Data.TaggedError(
  'SessionMetadataError'
)<{
  message: string;
  cause?: unknown;
}> {}

/**
 * SessionMetadataService implementation
 */
class SessionMetadataServiceImpl {
  private readonly metadataFile: string;
  private cache: Map<string, SessionMetadata> = new Map();

  constructor() {
    const cliveDir = path.join(os.homedir(), '.clive');
    this.metadataFile = path.join(cliveDir, 'session-metadata.json');
  }

  /**
   * Ensure ~/.clive directory exists
   */
  private ensureDirectory(): Effect.Effect<void, SessionMetadataError> {
    return Effect.tryPromise({
      try: async () => {
        const dir = path.dirname(this.metadataFile);
        if (!existsSync(dir)) {
          await mkdir(dir, { recursive: true });
        }
      },
      catch: (error) => new SessionMetadataError({
        message: 'Failed to create metadata directory',
        cause: error,
      }),
    });
  }

  /**
   * Load all session metadata from file
   */
  private loadMetadata(): Effect.Effect<Record<string, SessionMetadata>, SessionMetadataError> {
    return Effect.gen(this, function* () {
      // Ensure directory exists
      yield* this.ensureDirectory();

      // If file doesn't exist, return empty
      if (!existsSync(this.metadataFile)) {
        return {};
      }

      // Read file
      const content = yield* Effect.tryPromise({
        try: () => readFile(this.metadataFile, 'utf-8'),
        catch: (error) => new SessionMetadataError({
          message: 'Failed to read session metadata',
          cause: error,
        }),
      });

      // Parse JSON
      try {
        const data = JSON.parse(content);
        return data as Record<string, SessionMetadata>;
      } catch (error) {
        // If parse fails, return empty (corrupted file)
        return {};
      }
    });
  }

  /**
   * Save all session metadata to file
   */
  private saveMetadata(metadata: Record<string, SessionMetadata>): Effect.Effect<void, SessionMetadataError> {
    return Effect.gen(this, function* () {
      // Ensure directory exists
      yield* this.ensureDirectory();

      // Write file
      yield* Effect.tryPromise({
        try: () => writeFile(
          this.metadataFile,
          JSON.stringify(metadata, null, 2),
          'utf-8'
        ),
        catch: (error) => new SessionMetadataError({
          message: 'Failed to write session metadata',
          cause: error,
        }),
      });
    });
  }

  /**
   * Get metadata for a specific session
   */
  getMetadata(sessionId: string): Effect.Effect<SessionMetadata | null, SessionMetadataError> {
    return Effect.gen(this, function* () {
      // Check cache first
      if (this.cache.has(sessionId)) {
        return this.cache.get(sessionId) || null;
      }

      // Load from file
      const allMetadata = yield* this.loadMetadata();
      const metadata = allMetadata[sessionId] || null;

      // Update cache
      if (metadata) {
        this.cache.set(sessionId, metadata);
      }

      return metadata;
    });
  }

  /**
   * Set metadata for a session
   */
  setMetadata(sessionId: string, metadata: Partial<Omit<SessionMetadata, 'sessionId' | 'createdAt' | 'updatedAt'>>): Effect.Effect<SessionMetadata, SessionMetadataError> {
    return Effect.gen(this, function* () {
      // Load current metadata
      const allMetadata = yield* this.loadMetadata();
      const existing = allMetadata[sessionId];

      const now = Date.now();

      // Create or update metadata
      const updated: SessionMetadata = {
        ...existing,
        ...metadata,
        sessionId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };

      // Update in memory
      allMetadata[sessionId] = updated;
      this.cache.set(sessionId, updated);

      // Save to file
      yield* this.saveMetadata(allMetadata);

      return updated;
    });
  }

  /**
   * Associate a Linear project with a session
   */
  setLinearProject(sessionId: string, projectId: string, projectIdentifier?: string): Effect.Effect<SessionMetadata, SessionMetadataError> {
    return this.setMetadata(sessionId, {
      linearProjectId: projectId,
      linearProjectIdentifier: projectIdentifier,
    });
  }

  /**
   * Associate a Linear task with a session
   */
  setLinearTask(sessionId: string, taskId: string, taskIdentifier?: string): Effect.Effect<SessionMetadata, SessionMetadataError> {
    return this.setMetadata(sessionId, {
      linearTaskId: taskId,
      linearTaskIdentifier: taskIdentifier,
    });
  }

  /**
   * Get all metadata (for debugging/admin)
   */
  getAllMetadata(): Effect.Effect<Record<string, SessionMetadata>, SessionMetadataError> {
    return this.loadMetadata();
  }

  /**
   * Clear cache (useful when reloading)
   */
  clearCache(): Effect.Effect<void, never> {
    return Effect.sync(() => {
      this.cache.clear();
    });
  }
}

/**
 * SessionMetadataService context tag
 */
export class SessionMetadataService extends Context.Tag('SessionMetadataService')<
  SessionMetadataService,
  SessionMetadataServiceImpl
>() {
  /**
   * Default layer providing SessionMetadataService
   */
  static readonly Default = Layer.succeed(
    SessionMetadataService,
    new SessionMetadataServiceImpl()
  );
}
