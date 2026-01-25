/**
 * Slack Service
 *
 * Effect-TS wrapper around Slack Bolt client for message operations.
 * Provides postMessage, updateMessage, and postEphemeral with proper error handling.
 */

import type { Block, KnownBlock } from "@slack/types";
import type { WebClient } from "@slack/web-api";
import { Data, Effect } from "effect";

/**
 * Error when Slack API operations fail
 */
export class SlackServiceError extends Data.TaggedError("SlackServiceError")<{
  message: string;
  operation: string;
  cause?: unknown;
}> {}

/**
 * Result of posting a message
 */
export interface PostMessageResult {
  ts: string;
  channel: string;
}

/**
 * Options for posting a message
 */
export interface PostMessageOptions {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: (KnownBlock | Block)[];
  mrkdwn?: boolean;
}

/**
 * Options for updating a message
 */
export interface UpdateMessageOptions {
  channel: string;
  ts: string;
  text: string;
  blocks?: (KnownBlock | Block)[];
}

/**
 * Options for posting an ephemeral message
 */
export interface PostEphemeralOptions {
  channel: string;
  user: string;
  text: string;
  threadTs?: string;
  blocks?: (KnownBlock | Block)[];
}

/**
 * Slack Service wrapping Bolt client with Effect-TS
 */
export class SlackService {
  constructor(private client: WebClient) {}

  /**
   * Post a message to a channel or thread
   */
  postMessage(
    options: PostMessageOptions,
  ): Effect.Effect<PostMessageResult, SlackServiceError> {
    return Effect.gen(this, function* () {
      yield* Effect.logDebug(
        `[SlackService] Posting message to ${options.channel}${options.threadTs ? ` (thread: ${options.threadTs})` : ""}`,
      );

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await this.client.chat.postMessage({
            channel: options.channel,
            text: options.text,
            thread_ts: options.threadTs,
            blocks: options.blocks,
            mrkdwn: options.mrkdwn ?? true,
          });
          return response;
        },
        catch: (error) =>
          new SlackServiceError({
            message: `Failed to post message: ${String(error)}`,
            operation: "postMessage",
            cause: error,
          }),
      });

      if (!result.ok || !result.ts) {
        return yield* Effect.fail(
          new SlackServiceError({
            message: `Slack API returned error: ${result.error || "unknown"}`,
            operation: "postMessage",
          }),
        );
      }

      yield* Effect.logDebug(`[SlackService] Message posted: ${result.ts}`);

      return {
        ts: result.ts,
        channel: result.channel || options.channel,
      };
    });
  }

  /**
   * Update an existing message
   */
  updateMessage(
    options: UpdateMessageOptions,
  ): Effect.Effect<PostMessageResult, SlackServiceError> {
    return Effect.gen(this, function* () {
      yield* Effect.logDebug(
        `[SlackService] Updating message ${options.ts} in ${options.channel}`,
      );

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await this.client.chat.update({
            channel: options.channel,
            ts: options.ts,
            text: options.text,
            blocks: options.blocks,
          });
          return response;
        },
        catch: (error) =>
          new SlackServiceError({
            message: `Failed to update message: ${String(error)}`,
            operation: "updateMessage",
            cause: error,
          }),
      });

      if (!result.ok || !result.ts) {
        return yield* Effect.fail(
          new SlackServiceError({
            message: `Slack API returned error: ${result.error || "unknown"}`,
            operation: "updateMessage",
          }),
        );
      }

      yield* Effect.logDebug(`[SlackService] Message updated: ${result.ts}`);

      return {
        ts: result.ts,
        channel: result.channel || options.channel,
      };
    });
  }

  /**
   * Post an ephemeral message (only visible to one user)
   */
  postEphemeral(
    options: PostEphemeralOptions,
  ): Effect.Effect<void, SlackServiceError> {
    return Effect.gen(this, function* () {
      yield* Effect.logDebug(
        `[SlackService] Posting ephemeral to ${options.user} in ${options.channel}`,
      );

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await this.client.chat.postEphemeral({
            channel: options.channel,
            user: options.user,
            text: options.text,
            thread_ts: options.threadTs,
            blocks: options.blocks,
          });
          return response;
        },
        catch: (error) =>
          new SlackServiceError({
            message: `Failed to post ephemeral: ${String(error)}`,
            operation: "postEphemeral",
            cause: error,
          }),
      });

      if (!result.ok) {
        return yield* Effect.fail(
          new SlackServiceError({
            message: `Slack API returned error: ${result.error || "unknown"}`,
            operation: "postEphemeral",
          }),
        );
      }

      yield* Effect.logDebug("[SlackService] Ephemeral message posted");
    });
  }

  /**
   * Open a modal view
   */
  openModal(
    triggerId: string,
    view: Record<string, unknown>,
  ): Effect.Effect<void, SlackServiceError> {
    return Effect.gen(this, function* () {
      yield* Effect.logDebug(`[SlackService] Opening modal`);

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await this.client.views.open({
            trigger_id: triggerId,
            view: view as any,
          });
          return response;
        },
        catch: (error) =>
          new SlackServiceError({
            message: `Failed to open modal: ${String(error)}`,
            operation: "openModal",
            cause: error,
          }),
      });

      if (!result.ok) {
        return yield* Effect.fail(
          new SlackServiceError({
            message: `Slack API returned error: ${result.error || "unknown"}`,
            operation: "openModal",
          }),
        );
      }

      yield* Effect.logDebug("[SlackService] Modal opened");
    });
  }

  /**
   * Add a reaction to a message
   */
  addReaction(
    channel: string,
    timestamp: string,
    emoji: string,
  ): Effect.Effect<void, SlackServiceError> {
    return Effect.gen(this, function* () {
      yield* Effect.logDebug(
        `[SlackService] Adding reaction :${emoji}: to ${timestamp}`,
      );

      const result = yield* Effect.tryPromise({
        try: async () => {
          const response = await this.client.reactions.add({
            channel,
            timestamp,
            name: emoji,
          });
          return response;
        },
        catch: (error) =>
          new SlackServiceError({
            message: `Failed to add reaction: ${String(error)}`,
            operation: "addReaction",
            cause: error,
          }),
      });

      if (!result.ok) {
        return yield* Effect.fail(
          new SlackServiceError({
            message: `Slack API returned error: ${result.error || "unknown"}`,
            operation: "addReaction",
          }),
        );
      }

      yield* Effect.logDebug("[SlackService] Reaction added");
    });
  }
}
