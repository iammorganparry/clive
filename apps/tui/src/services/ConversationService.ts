/**
 * ConversationService
 * Fetches and manages Claude CLI conversation history
 * Reads from ~/.claude/history.jsonl and ~/.claude/projects/
 *
 * Built with Effect-TS for proper error handling and composability
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Context, Data, Effect, Layer } from "effect";
import { SessionMetadataService } from "./SessionMetadataService";

export interface Conversation {
  sessionId: string;
  project: string;
  display: string; // First user message
  timestamp: number;
  slug?: string; // Human-readable name from conversation file
  gitBranch?: string;
  linearProjectId?: string;
  linearProjectIdentifier?: string;
  linearTaskId?: string;
  linearTaskIdentifier?: string;
}

/**
 * Error when conversation history file is not found
 */
export class ConversationHistoryNotFoundError extends Data.TaggedError(
  "ConversationHistoryNotFoundError",
)<{
  message: string;
  path: string;
}> {}

/**
 * Error when reading or parsing conversation data
 */
export class ConversationReadError extends Data.TaggedError(
  "ConversationReadError",
)<{
  message: string;
  cause?: unknown;
}> {}

/**
 * ConversationService implementation
 */
class ConversationServiceImpl {
  private readonly claudeDir: string;
  private readonly historyFile: string;
  private readonly projectsDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), ".claude");
    this.historyFile = path.join(this.claudeDir, "history.jsonl");
    this.projectsDir = path.join(this.claudeDir, "projects");
  }

  /**
   * Get recent conversations grouped by session
   * Returns most recent conversations first
   */
  getRecentConversations(
    limit: number = 50,
  ): Effect.Effect<
    Conversation[],
    ConversationHistoryNotFoundError | ConversationReadError
  > {
    return Effect.gen(this, function* () {
      // Check if history file exists
      if (!existsSync(this.historyFile)) {
        return [];
      }

      // Read history file
      const historyContent = yield* Effect.tryPromise({
        try: () => readFile(this.historyFile, "utf-8"),
        catch: (error) =>
          new ConversationReadError({
            message: "Failed to read conversation history",
            cause: error,
          }),
      });

      const lines = historyContent.trim().split("\n");

      // Parse history entries
      const historyEntries: Array<{
        sessionId: string;
        project: string;
        display: string;
        timestamp: number;
      }> = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const entry = JSON.parse(line);
          if (
            entry.sessionId &&
            entry.project &&
            entry.display &&
            entry.timestamp
          ) {
            historyEntries.push({
              sessionId: entry.sessionId,
              project: entry.project,
              display: entry.display,
              timestamp: entry.timestamp,
            });
          }
        } catch (_error) {}
      }

      // Group by sessionId and take the first entry (original prompt) for each session
      const sessionMap = new Map<string, Conversation>();

      // Process in reverse order (newest first)
      for (let i = historyEntries.length - 1; i >= 0; i--) {
        const entry = historyEntries[i];

        // Only keep the first (earliest) entry for each session
        // which represents the initial prompt
        if (!sessionMap.has(entry.sessionId)) {
          sessionMap.set(entry.sessionId, {
            sessionId: entry.sessionId,
            project: entry.project,
            display: entry.display,
            timestamp: entry.timestamp,
          });
        }
      }

      // Convert to array and sort by timestamp (newest first)
      const conversations = Array.from(sessionMap.values())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);

      // Enrich with slug and git branch from conversation files
      yield* this.enrichConversations(conversations);

      // Enrich with Linear metadata from SessionMetadataService
      yield* this.enrichWithLinearMetadata(conversations);

      return conversations;
    });
  }

  /**
   * Get conversations for a specific project/directory
   */
  getConversationsForProject(
    projectPath: string,
    limit: number = 50,
  ): Effect.Effect<
    Conversation[],
    ConversationHistoryNotFoundError | ConversationReadError
  > {
    return Effect.gen(this, function* () {
      // Get more conversations to filter
      const allConversations = yield* this.getRecentConversations(200);

      return allConversations
        .filter((conv) => conv.project === projectPath)
        .slice(0, limit);
    });
  }

  /**
   * Enrich conversations with slug and git branch from conversation files
   */
  private enrichConversations(
    conversations: Conversation[],
  ): Effect.Effect<void, ConversationReadError> {
    return Effect.gen(this, function* () {
      for (const conv of conversations) {
        try {
          // Encode project path for directory name (same as CLI does)
          const encodedProject = this.encodeProjectPath(conv.project);
          const projectDir = path.join(this.projectsDir, encodedProject);
          const conversationFile = path.join(
            projectDir,
            `${conv.sessionId}.jsonl`,
          );

          if (!existsSync(conversationFile)) {
            continue;
          }

          // Read first line to get slug and git branch
          const content = yield* Effect.tryPromise({
            try: () => readFile(conversationFile, "utf-8"),
            catch: () =>
              new ConversationReadError({
                message: `Failed to read conversation file: ${conversationFile}`,
              }),
          });

          const firstLine = content.split("\n")[0];

          if (firstLine) {
            const data = JSON.parse(firstLine);
            conv.slug = data.slug;
            conv.gitBranch = data.gitBranch;
          }
        } catch (_error) {}
      }
    });
  }

  /**
   * Enrich conversations with Linear metadata from SessionMetadataService
   * Errors are caught gracefully - metadata enrichment is optional
   */
  private enrichWithLinearMetadata(
    conversations: Conversation[],
  ): Effect.Effect<void, never> {
    return Effect.gen(this, function* () {
      const metadataService = yield* SessionMetadataService;

      for (const conv of conversations) {
        // Fetch metadata for this session, catching any errors
        const metadataEffect = metadataService
          .getMetadata(conv.sessionId)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        const metadata = yield* metadataEffect;

        if (metadata) {
          // Merge Linear metadata into conversation
          conv.linearProjectId = metadata.linearProjectId;
          conv.linearProjectIdentifier = metadata.linearProjectIdentifier;
          conv.linearTaskId = metadata.linearTaskId;
          conv.linearTaskIdentifier = metadata.linearTaskIdentifier;
        }
      }
    });
  }

  /**
   * Encode project path for directory name
   * Mimics the CLI's encoding: replace / with - and remove : (for Windows)
   */
  private encodeProjectPath(projectPath: string): string {
    return projectPath.replace(/\//g, "-").replace(/:/g, "");
  }

  /**
   * Get conversation details (full transcript)
   */
  getConversationDetails(
    sessionId: string,
    projectPath: string,
  ): Effect.Effect<any[], ConversationReadError> {
    return Effect.gen(this, function* () {
      const encodedProject = this.encodeProjectPath(projectPath);
      const projectDir = path.join(this.projectsDir, encodedProject);
      const conversationFile = path.join(projectDir, `${sessionId}.jsonl`);

      if (!existsSync(conversationFile)) {
        return [];
      }

      const content = yield* Effect.tryPromise({
        try: () => readFile(conversationFile, "utf-8"),
        catch: (error) =>
          new ConversationReadError({
            message: `Failed to read conversation file: ${conversationFile}`,
            cause: error,
          }),
      });

      const lines = content.trim().split("\n");

      const events = [];
      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          events.push(JSON.parse(line));
        } catch (_error) {}
      }

      return events;
    });
  }

  /**
   * Check if a conversation exists
   */
  conversationExists(
    sessionId: string,
    projectPath: string,
  ): Effect.Effect<boolean, never> {
    return Effect.sync(() => {
      const encodedProject = this.encodeProjectPath(projectPath);
      const projectDir = path.join(this.projectsDir, encodedProject);
      const conversationFile = path.join(projectDir, `${sessionId}.jsonl`);

      return existsSync(conversationFile);
    });
  }
}

/**
 * ConversationService context tag
 */
export class ConversationService extends Context.Tag("ConversationService")<
  ConversationService,
  ConversationServiceImpl
>() {
  /**
   * Default layer providing ConversationService
   */
  static readonly Default = Layer.succeed(
    ConversationService,
    new ConversationServiceImpl(),
  );
}
