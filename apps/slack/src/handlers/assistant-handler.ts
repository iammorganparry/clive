/**
 * Assistant Handler
 *
 * Registers the Slack AI App (Agents & Assistants) surface using Bolt's
 * Assistant class. Provides a split-view panel experience alongside the
 * existing @mention flow.
 *
 * Supports both local (ClaudeManager) and distributed (WorkerProxy) modes.
 */

import { Assistant } from "@slack/bolt";
import type { App } from "@slack/bolt";
import type { InterviewEvent as WorkerInterviewEvent } from "@clive/worker-protocol";
import { Effect } from "effect";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";
import type { InterviewEvent } from "../store/types";
import { AssistantEventHandler } from "./assistant-event-handler";
import {
  getContextAwarePrompts,
  generateThreadTitle,
  getLoadingMessage,
  type AssistantContext,
} from "./assistant-prompts";
import {
  formatTimeoutMessage,
  formatErrorMessage,
} from "../formatters/question-formatter";
import { runHandlerEffect } from "./handler-utils";

/**
 * Register the assistant handler for local mode (single-user with ClaudeManager)
 */
export function registerAssistantHandler(
  app: App,
  store: InterviewStore,
  claudeManager: ClaudeManager,
  slackService: SlackService,
): void {
  const eventHandler = new AssistantEventHandler(app.client);

  const assistant = new Assistant({
    threadStarted: async ({ saveThreadContext, setSuggestedPrompts, say }) => {
      await saveThreadContext();

      await say("Hi there! I'm Clive, your AI planning assistant. How can I help you today?");

      await setSuggestedPrompts({
        prompts: getContextAwarePrompts(),
        title: "Here are some things I can help with:",
      });
    },

    threadContextChanged: async ({ saveThreadContext }) => {
      await saveThreadContext();
    },

    userMessage: async ({
      message,
      say,
      setStatus,
      setTitle,
      getThreadContext,
      client,
    }) => {
      const msg = message as {
        text?: string;
        channel?: string;
        thread_ts?: string;
        ts?: string;
        user?: string;
      };
      const channelId = msg.channel;
      const threadTs = msg.thread_ts || msg.ts;
      const userId = msg.user;
      const text = msg.text || "";

      if (!channelId || !threadTs || !userId) {
        console.error("[AssistantHandler] Missing required message fields");
        return;
      }

      const sessionKey = store.getAssistantSessionKey(channelId, threadTs);

      // Set loading status
      await setStatus(getLoadingMessage());

      // Get or create session
      let session = store.get(sessionKey);
      const isFirstMessage = !session;

      if (!session) {
        // Get thread context for the session
        let assistantContext: AssistantContext | undefined;
        try {
          assistantContext = await getThreadContext();
        } catch {
          // Context may not be available
        }

        session = store.createAssistantSession(
          channelId,
          threadTs,
          userId,
          assistantContext,
        );

        // Set thread title on first message
        await setTitle(generateThreadTitle(text));

        // Set up timeout handler
        store.onTimeout(sessionKey, async (timedOutSession) => {
          console.log(`[AssistantHandler] Session ${sessionKey} timed out`);
          await say("This session has timed out after 30 minutes of inactivity. Start a new conversation to continue.");
          store.close(sessionKey);
        });
      }

      // Update activity
      store.touch(sessionKey);

      // Start streaming
      await eventHandler.startStream(channelId, threadTs, sessionKey);

      if (isFirstMessage || !session.claudeHandle) {
        // Start a new Claude interview
        store.setMode(sessionKey, "plan");
        store.setPhase(sessionKey, "problem");

        await runHandlerEffect(
          Effect.gen(function* () {
            const handle = yield* claudeManager.startInterview(
              sessionKey,
              text,
              async (event: InterviewEvent) => {
                await eventHandler.handleLocalEvent(
                  event,
                  sessionKey,
                  channelId,
                  threadTs,
                  store,
                  (msg) => {
                    if (typeof msg === "string") {
                      return say(msg) as Promise<unknown>;
                    }
                    return say(msg) as Promise<unknown>;
                  },
                );
              },
            ).pipe(
              Effect.catchTag("ClaudeManagerError", (error) =>
                Effect.gen(function* () {
                  console.error(
                    `[AssistantHandler] Failed to start interview:`,
                    error.message,
                  );
                  yield* Effect.promise(() =>
                    eventHandler.stopStream(sessionKey, channelId),
                  );
                  yield* Effect.promise(() =>
                    say(`Failed to start: ${error.message}`),
                  );
                  store.close(sessionKey);
                  return undefined;
                }),
              ),
            );

            if (handle) {
              store.setClaudeHandle(sessionKey, handle);
            }
          }),
          "assistant_local_message",
        );
      } else {
        // Follow-up message to existing session
        claudeManager.sendMessage(sessionKey, text);
      }
    },
  });

  app.assistant(assistant);
  console.log("[AssistantHandler] Registered assistant handler (local mode)");
}

/**
 * Register the assistant handler for distributed mode (worker swarm)
 */
export function registerAssistantHandlerDistributed(
  app: App,
  store: InterviewStore,
  workerProxy: WorkerProxy,
  slackService: SlackService,
): void {
  const eventHandler = new AssistantEventHandler(app.client);

  const assistant = new Assistant({
    threadStarted: async ({ saveThreadContext, setSuggestedPrompts, say }) => {
      await saveThreadContext();

      await say("Hi there! I'm Clive, your AI planning assistant. How can I help you today?");

      await setSuggestedPrompts({
        prompts: getContextAwarePrompts(),
        title: "Here are some things I can help with:",
      });
    },

    threadContextChanged: async ({ saveThreadContext }) => {
      await saveThreadContext();
    },

    userMessage: async ({
      message,
      say,
      setStatus,
      setTitle,
      getThreadContext,
      client,
    }) => {
      const msg = message as {
        text?: string;
        channel?: string;
        thread_ts?: string;
        ts?: string;
        user?: string;
      };
      const channelId = msg.channel;
      const threadTs = msg.thread_ts || msg.ts;
      const userId = msg.user;
      const text = msg.text || "";

      if (!channelId || !threadTs || !userId) {
        console.error("[AssistantHandler] Missing required message fields");
        return;
      }

      const sessionKey = store.getAssistantSessionKey(channelId, threadTs);

      // Set loading status
      await setStatus(getLoadingMessage());

      // Get or create session
      let session = store.get(sessionKey);
      const isFirstMessage = !session;

      if (!session) {
        // Get thread context for the session
        let assistantContext: AssistantContext | undefined;
        try {
          assistantContext = await getThreadContext();
        } catch {
          // Context may not be available
        }

        session = store.createAssistantSession(
          channelId,
          threadTs,
          userId,
          assistantContext,
        );

        // Set thread title on first message
        await setTitle(generateThreadTitle(text));

        // Set up timeout handler
        store.onTimeout(sessionKey, async (timedOutSession) => {
          console.log(`[AssistantHandler] Session ${sessionKey} timed out`);
          workerProxy.cancelSession(sessionKey, "timeout");
          await say("This session has timed out after 30 minutes of inactivity. Start a new conversation to continue.");
          store.close(sessionKey);
        });
      }

      // Update activity
      store.touch(sessionKey);

      // Start streaming
      await eventHandler.startStream(channelId, threadTs, sessionKey);

      if (isFirstMessage || !session.workerId) {
        // Start new interview via worker
        store.setMode(sessionKey, "plan");
        store.setPhase(sessionKey, "problem");

        await runHandlerEffect(
          Effect.gen(function* () {
            const result = yield* workerProxy.startInterview(
              sessionKey,
              channelId,
              userId,
              text,
              async (event: WorkerInterviewEvent) => {
                // Map worker events to local event format for the event handler
                const payload = event.payload;
                await eventHandler.handleDistributedEvent(
                  payload as unknown as InterviewEvent,
                  sessionKey,
                  channelId,
                  threadTs,
                  store,
                  (msg) => {
                    if (typeof msg === "string") {
                      return say(msg) as Promise<unknown>;
                    }
                    return say(msg) as Promise<unknown>;
                  },
                );
              },
            ).pipe(
              Effect.catchTag("WorkerProxyError", (error) =>
                Effect.gen(function* () {
                  console.error(
                    `[AssistantHandler] Failed to start interview:`,
                    error.message,
                  );
                  yield* Effect.promise(() =>
                    eventHandler.stopStream(sessionKey, channelId),
                  );
                  yield* Effect.promise(() =>
                    say(`Failed to start: ${error.message}`),
                  );
                  store.close(sessionKey);
                  return undefined;
                }),
              ),
            );

            if (result && "workerId" in result) {
              store.setWorkerId(sessionKey, result.workerId);
            } else if (result && "queued" in result) {
              yield* Effect.promise(() =>
                eventHandler.stopStream(sessionKey, channelId),
              );
              yield* Effect.promise(() =>
                say(
                  `All workers are busy. You're #${result.position} in the queue. I'll start as soon as one is available.`,
                ),
              );
            }
          }),
          "assistant_distributed_message",
        );
      } else {
        // Follow-up message to existing session
        workerProxy.sendMessage(sessionKey, text);
      }
    },
  });

  app.assistant(assistant);
  console.log(
    "[AssistantHandler] Registered assistant handler (distributed mode)",
  );
}
