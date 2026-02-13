/**
 * Assistant Event Handler
 *
 * Translates InterviewEvent (local) and worker protocol events (distributed)
 * into assistant-surface responses. Uses Slack streaming APIs for progressive
 * delivery and falls back to say() for interactive blocks.
 */

import type { WebClient } from "@slack/web-api";
import type { KnownBlock } from "@slack/types";
import { formatMarkdown, section } from "../formatters/block-builder";
import {
  formatQuestionData,
  formatCompletionMessage,
  formatErrorMessage,
  formatPhaseIndicator,
} from "../formatters/question-formatter";
import type { InterviewStore } from "../store/interview-store";
import type { InterviewEvent } from "../store/types";

/**
 * Minimum interval between stream updates (Slack rate limit)
 */
const STREAM_UPDATE_INTERVAL_MS = 3_000;

/**
 * Tracks rate limit state per thread
 */
interface StreamState {
  /** Timestamp of the last stream update */
  lastUpdateAt: number;
  /** Pending text to flush on next allowed update */
  pendingText: string;
  /** Stream message timestamp (from startStream) */
  streamTs?: string;
  /** Channel ID for the stream */
  channelId: string;
  /** Whether a stream is currently active */
  isStreaming: boolean;
  /** Flush timer handle */
  flushTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Manages streaming state and rate limiting for assistant threads
 */
export class AssistantEventHandler {
  private streamStates = new Map<string, StreamState>();

  constructor(private client: WebClient) {}

  /**
   * Start a new stream for a session
   */
  async startStream(
    channelId: string,
    threadTs: string,
    sessionKey: string,
  ): Promise<void> {
    try {
      const result = await this.client.chat.startStream({
        channel: channelId,
        thread_ts: threadTs,
      });

      this.streamStates.set(sessionKey, {
        lastUpdateAt: Date.now(),
        pendingText: "",
        streamTs: result.ts,
        channelId,
        isStreaming: true,
      });

      console.log(
        `[AssistantEventHandler] Stream started for ${sessionKey}: ${result.ts}`,
      );
    } catch (error) {
      console.error(
        `[AssistantEventHandler] Failed to start stream for ${sessionKey}:`,
        error,
      );
    }
  }

  /**
   * Append text to an active stream, respecting rate limits
   */
  async appendToStream(sessionKey: string, text: string): Promise<void> {
    const state = this.streamStates.get(sessionKey);
    if (!state?.isStreaming || !state.streamTs) {
      return;
    }

    state.pendingText += text;

    if (this.canUpdate(state)) {
      await this.flushStream(sessionKey);
    } else if (!state.flushTimer) {
      // Schedule a flush for when the rate limit window opens
      const waitMs =
        STREAM_UPDATE_INTERVAL_MS - (Date.now() - state.lastUpdateAt);
      state.flushTimer = setTimeout(async () => {
        state.flushTimer = undefined;
        await this.flushStream(sessionKey);
      }, waitMs);
    }
  }

  /**
   * Stop the active stream and optionally post final blocks
   */
  async stopStream(
    sessionKey: string,
    channelId: string,
    blocks?: KnownBlock[],
  ): Promise<void> {
    const state = this.streamStates.get(sessionKey);
    if (!state?.streamTs) {
      return;
    }

    // Clear any pending flush
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = undefined;
    }

    try {
      await this.client.chat.stopStream({
        channel: channelId,
        ts: state.streamTs,
        ...(blocks ? { blocks } : {}),
      });

      console.log(
        `[AssistantEventHandler] Stream stopped for ${sessionKey}`,
      );
    } catch (error) {
      console.error(
        `[AssistantEventHandler] Failed to stop stream for ${sessionKey}:`,
        error,
      );
    }

    state.isStreaming = false;
    this.streamStates.delete(sessionKey);
  }

  /**
   * Handle a local-mode InterviewEvent and route to streaming/say
   */
  async handleLocalEvent(
    event: InterviewEvent,
    sessionKey: string,
    channelId: string,
    threadTs: string,
    store: InterviewStore,
    say: (msg: string | { text: string; blocks?: KnownBlock[] }) => Promise<unknown>,
  ): Promise<void> {
    await this.handleEvent(
      event.type,
      event,
      sessionKey,
      channelId,
      threadTs,
      store,
      say,
    );
  }

  /**
   * Handle a distributed-mode worker event and route to streaming/say
   */
  async handleDistributedEvent(
    eventPayload: InterviewEvent,
    sessionKey: string,
    channelId: string,
    threadTs: string,
    store: InterviewStore,
    say: (msg: string | { text: string; blocks?: KnownBlock[] }) => Promise<unknown>,
  ): Promise<void> {
    await this.handleEvent(
      eventPayload.type,
      eventPayload,
      sessionKey,
      channelId,
      threadTs,
      store,
      say,
    );
  }

  /**
   * Core event handling logic shared between local and distributed modes
   */
  private async handleEvent(
    type: string,
    event: InterviewEvent,
    sessionKey: string,
    channelId: string,
    threadTs: string,
    store: InterviewStore,
    say: (msg: string | { text: string; blocks?: KnownBlock[] }) => Promise<unknown>,
  ): Promise<void> {
    console.log(`[AssistantEventHandler] Event: ${type} for ${sessionKey}`);

    switch (type) {
      case "session_started": {
        if (event.type === "session_started") {
          store.setClaudeSessionId(sessionKey, event.claudeSessionId);
        }
        break;
      }

      case "text": {
        if (event.type === "text") {
          await this.appendToStream(sessionKey, event.content);
        }
        break;
      }

      case "question": {
        if (event.type === "question") {
          // Stop streaming before posting interactive blocks
          await this.stopStream(sessionKey, channelId);

          store.setPendingQuestion(sessionKey, event.data, event.data.toolUseID);

          await say({
            text: "Please answer the following question:",
            blocks: formatQuestionData(event.data),
          });

          // Restart stream for next response chunk
          await this.startStream(channelId, threadTs, sessionKey);
        }
        break;
      }

      case "phase_change": {
        if (event.type === "phase_change") {
          store.setPhase(sessionKey, event.phase);
        }
        break;
      }

      case "plan_ready": {
        if (event.type === "plan_ready") {
          store.setPhase(sessionKey, "reviewing");
          store.setPlanContent(sessionKey, event.content);

          // Stop streaming and post plan as blocks
          await this.stopStream(sessionKey, channelId);

          const formattedPlan = formatMarkdown(event.content);
          await say({
            text: "Plan ready for review",
            blocks: [
              section("*Plan Ready for Review*"),
              section(formattedPlan.substring(0, 2900)),
            ],
          });
        }
        break;
      }

      case "issues_created": {
        if (event.type === "issues_created") {
          store.setPhase(sessionKey, "completed");
          for (const url of event.urls) {
            store.addLinearIssueUrl(sessionKey, url);
          }

          await this.stopStream(sessionKey, channelId);

          await say({
            text: "Planning complete! Issues created.",
            blocks: formatCompletionMessage(event.urls),
          });

          store.close(sessionKey);
        }
        break;
      }

      case "pr_created": {
        if (event.type === "pr_created") {
          store.setPrUrl(sessionKey, event.url);

          await this.stopStream(sessionKey, channelId);

          await say({
            text: `PR created: ${event.url}`,
            blocks: [
              section(":rocket: *Pull Request Created*"),
              section(`<${event.url}|View PR on GitHub>`),
            ],
          });

          // Restart stream in case more content follows
          await this.startStream(channelId, threadTs, sessionKey);
        }
        break;
      }

      case "error": {
        if (event.type === "error") {
          store.setError(sessionKey, event.message);

          await this.stopStream(sessionKey, channelId);

          await say({
            text: `Error: ${event.message}`,
            blocks: formatErrorMessage(event.message),
          });
        }
        break;
      }

      case "complete": {
        const session = store.get(sessionKey);
        if (
          session &&
          session.phase !== "completed" &&
          session.phase !== "error"
        ) {
          store.setPhase(sessionKey, "completed");

          // Stop streaming with a completion block
          await this.stopStream(sessionKey, channelId, [
            section(
              ":white_check_mark: *Done!* Let me know if you need anything else.",
            ),
          ]);

          // Show Linear URLs if available
          if (
            session.linearIssueUrls &&
            session.linearIssueUrls.length > 0
          ) {
            await say({
              text: "Planning complete!",
              blocks: formatCompletionMessage(session.linearIssueUrls),
            });
          }

          store.close(sessionKey);
        }
        break;
      }

      case "timeout": {
        await this.stopStream(sessionKey, channelId);

        await say({
          text: "Session timed out after 30 minutes of inactivity.",
        });

        store.close(sessionKey);
        break;
      }
    }
  }

  /**
   * Check if we can send an update without hitting rate limits
   */
  private canUpdate(state: StreamState): boolean {
    return Date.now() - state.lastUpdateAt >= STREAM_UPDATE_INTERVAL_MS;
  }

  /**
   * Flush pending text to the stream
   */
  private async flushStream(sessionKey: string): Promise<void> {
    const state = this.streamStates.get(sessionKey);
    if (!state?.isStreaming || !state.streamTs || !state.pendingText) {
      return;
    }

    const text = state.pendingText;
    state.pendingText = "";
    state.lastUpdateAt = Date.now();

    try {
      await this.client.chat.appendStream({
        channel: state.channelId,
        ts: state.streamTs,
        markdown_text: text,
      });
    } catch (error) {
      console.error(
        `[AssistantEventHandler] Failed to append stream for ${sessionKey}:`,
        error,
      );
    }
  }

  /**
   * Clean up all stream states (for shutdown)
   */
  closeAll(): void {
    for (const [key, state] of this.streamStates) {
      if (state.flushTimer) {
        clearTimeout(state.flushTimer);
      }
    }
    this.streamStates.clear();
  }
}
