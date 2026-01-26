/**
 * Mention Handler
 *
 * Handles @clive mentions in Slack channels to start planning interviews.
 * Supports both local (ClaudeManager) and distributed (WorkerProxy) modes.
 */

import type { InterviewEvent as WorkerInterviewEvent } from "@clive/worker-protocol";
import type { App } from "@slack/bolt";
import type { AppMentionEvent } from "@slack/types";
import { Effect } from "effect";
import { formatMarkdown, section } from "../formatters/block-builder";
import {
  formatCompletionMessage,
  formatErrorMessage,
  formatPhaseIndicator,
  formatQuestionData,
  formatTimeoutMessage,
} from "../formatters/question-formatter";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";
import type { InterviewEvent } from "../store/types";
import { runHandlerEffect } from "./handler-utils";

/**
 * Extract description from @mention text
 * @clive build a login feature -> "build a login feature"
 * @clive -> ""
 */
function extractDescription(text: string, botUserId: string): string {
  // Pattern: <@BOTID> optional_description
  const mentionPattern = new RegExp(`<@${botUserId}>\\s*(.*)`, "i");
  const match = text.match(mentionPattern);
  return match?.[1]?.trim() || "";
}

/**
 * Project detection patterns
 * Matches phrases like:
 * - "in the marketing app"
 * - "in our backend"
 * - "for the api-service"
 * - "on frontend project"
 */
const PROJECT_PATTERNS = [
  /(?:in|on|for|with)\s+(?:the|our|my)?\s*([a-z0-9][-a-z0-9]*(?:[-\s][a-z0-9][-a-z0-9]*)*)\s+(?:app|project|service|repo|codebase)/i,
  /(?:in|on|for|with)\s+(?:the|our|my)?\s*([a-z0-9][-a-z0-9]*(?:[-\s][a-z0-9][-a-z0-9]*)*)\s*$/i,
  /(?:^|\s)([a-z0-9][-a-z0-9]*)\s+(?:app|project|service|repo|codebase)/i,
];

/**
 * Extract potential project name from description
 * Returns the first project-like match or undefined if none found
 */
export function extractProjectName(description: string): string | undefined {
  if (!description) return undefined;

  for (const pattern of PROJECT_PATTERNS) {
    const match = description.match(pattern);
    if (match?.[1]) {
      const projectName = match[1].trim().toLowerCase().replace(/\s+/g, "-");
      // Skip common words that aren't project names
      if (
        !["the", "a", "an", "this", "that", "my", "our", "your"].includes(
          projectName,
        )
      ) {
        return projectName;
      }
    }
  }

  return undefined;
}

/**
 * Register the @mention handler
 */
export function registerMentionHandler(
  app: App,
  store: InterviewStore,
  claudeManager: ClaudeManager,
  slackService: SlackService,
): void {
  app.event("app_mention", async ({ event, context, say }) => {
    const mentionEvent = event as AppMentionEvent;
    const channel = mentionEvent.channel;
    const messageTs = mentionEvent.ts;
    const userId = mentionEvent.user;
    const text = mentionEvent.text;
    const threadTsFromEvent = mentionEvent.thread_ts;
    const botUserId = context.botUserId || "";

    // Validate required fields
    if (!userId) {
      console.error("[MentionHandler] Missing user ID in mention event");
      return;
    }

    console.log(
      `[MentionHandler] Received mention from ${userId} in ${channel}`,
    );

    // Use the original message ts as thread, or if already in thread, use existing thread_ts
    const threadTs = threadTsFromEvent || messageTs;

    // Check for existing session in this thread
    if (store.has(threadTs)) {
      const existingSession = store.get(threadTs);

      // If session is in error or completed state, close it and allow new session
      if (existingSession && (existingSession.phase === "error" || existingSession.phase === "completed")) {
        console.log(`[MentionHandler] Closing stale session ${threadTs} (phase: ${existingSession.phase})`);
        store.close(threadTs);
        // Fall through to create new session
      } else if (existingSession) {
        // Active session exists - treat this @mention as a follow-up message
        console.log(`[MentionHandler] Session exists for thread ${threadTs}, forwarding as message`);

        // Extract the message text (without the @mention)
        const messageText = extractDescription(text, botUserId);
        if (messageText) {
          // Check if user is the initiator
          if (!store.isInitiator(threadTs, userId)) {
            console.log(`[MentionHandler] Non-initiator @mention, ignoring`);
            return;
          }

          // Update activity timestamp
          store.touch(threadTs);

          // Send as follow-up message to Claude
          claudeManager.sendMessage(threadTs, messageText);

          // Add thinking indicator
          await Effect.runPromise(
            slackService.addReaction(channel, messageTs, "thinking_face"),
          );
        }
        return;
      }
    }

    // Extract description from mention
    const description = extractDescription(text, botUserId);
    console.log(`[MentionHandler] Description: "${description || "(none)"}"`);

    // Create new session
    const _session = store.create(threadTs, channel, userId, description);

    // Set up timeout handler
    store.onTimeout(threadTs, async (timedOutSession) => {
      console.log(`[MentionHandler] Session ${threadTs} timed out`);
      await Effect.runPromise(
        slackService.postMessage({
          channel: timedOutSession.channel,
          text: `<@${timedOutSession.initiatorId}> Interview timed out after 30 minutes of inactivity.`,
          blocks: formatTimeoutMessage(timedOutSession.initiatorId),
        }),
      );
      store.close(threadTs);
    });

    // Start greeting conversation using Effect
    await runHandlerEffect(
      Effect.gen(function* () {
        // If user provided a description, skip greeting and go straight to planning
        if (description) {
          // Don't post welcome message - wait for Claude's first response
          store.setMode(threadTs, "plan");
          store.setPhase(threadTs, "problem");

          const handle = yield* claudeManager.startInterview(
            threadTs,
            description,
            async (event: InterviewEvent) => {
              await handleInterviewEvent(
                event,
                threadTs,
                channel,
                store,
                slackService,
              );
            },
          ).pipe(
            Effect.catchTag("ClaudeManagerError", (error) =>
              Effect.gen(function* () {
                console.error(`[MentionHandler] Failed to start interview:`, error.message);
                store.setError(threadTs, error.message);
                yield* slackService.postMessage({
                  channel,
                  text: `<@${userId}> Failed to start: ${error.message}`,
                  blocks: formatErrorMessage(error.message, userId),
                });
                store.close(threadTs);
                return undefined;
              }),
            ),
          );

          if (handle) {
            store.setClaudeHandle(threadTs, handle);
          }
        } else {
          // No description - start with conversational greeting
          // Don't post welcome message - Claude will respond naturally
          const handle = yield* claudeManager.startGreeting(
            threadTs,
            channel,
            userId,
            undefined,
            async (event: InterviewEvent) => {
              await handleInterviewEvent(
                event,
                threadTs,
                channel,
                store,
                slackService,
              );
            },
          ).pipe(
            Effect.catchTag("ClaudeManagerError", (error) =>
              Effect.gen(function* () {
                console.error(`[MentionHandler] Failed to start greeting:`, error.message);
                store.setError(threadTs, error.message);
                yield* slackService.postMessage({
                  channel,
                  text: `<@${userId}> Failed to start: ${error.message}`,
                  blocks: formatErrorMessage(error.message, userId),
                });
                store.close(threadTs);
                return undefined;
              }),
            ),
          );

          if (handle) {
            store.setClaudeHandle(threadTs, handle);
          }
        }
      }),
      "local_mention",
    );
  });
}

/**
 * Handle events from Claude interview
 */
async function handleInterviewEvent(
  event: InterviewEvent,
  threadTs: string,
  channel: string,
  store: InterviewStore,
  slackService: SlackService,
): Promise<void> {
  console.log(`[MentionHandler] Interview event: ${event.type}`);

  // Get userId from session for tagging
  const session = store.get(threadTs);
  const userId = session?.initiatorId;

  switch (event.type) {
    case "question": {
      // Store pending question
      store.setPendingQuestion(threadTs, event.data, event.data.toolUseID);

      // Post question to Slack thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Please answer the following question:`,
          blocks: formatQuestionData(event.data, userId),
        }),
      );
      break;
    }

    case "phase_change": {
      store.setPhase(threadTs, event.phase);

      // Post phase indicator to thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Phase: ${event.phase}`,
          blocks: formatPhaseIndicator(event.phase, userId),
        }),
      );
      break;
    }

    case "text": {
      // Post text content to thread
      const formattedText = formatMarkdown(event.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> ${event.content.substring(0, 200)}...`,
          blocks: [section(`<@${userId}> ${formattedText}`)],
        }),
      );
      break;
    }

    case "plan_ready": {
      store.setPhase(threadTs, "reviewing");
      store.setPlanContent(threadTs, event.content);

      // Post plan preview to thread
      const formattedPlan = formatMarkdown(event.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Plan ready for review`,
          blocks: [
            section(`<@${userId}> *Plan Ready for Review*`),
            section(formattedPlan.substring(0, 2900)),
          ],
        }),
      );
      break;
    }

    case "issues_created": {
      store.setPhase(threadTs, "completed");
      for (const url of event.urls) {
        store.addLinearIssueUrl(threadTs, url);
      }

      // Post completion message to thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Planning complete! Issues created.`,
          blocks: formatCompletionMessage(event.urls, userId),
        }),
      );

      // Close session
      store.close(threadTs);
      break;
    }

    case "error": {
      store.setError(threadTs, event.message);

      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Error: ${event.message}`,
          blocks: formatErrorMessage(event.message, userId),
        }),
      );
      break;
    }

    case "complete": {
      const currentSession = store.get(threadTs);
      if (
        currentSession &&
        currentSession.phase !== "completed" &&
        currentSession.phase !== "error"
      ) {
        store.setPhase(threadTs, "completed");

        // If we have Linear URLs, show them with build transition
        if (currentSession.linearIssueUrls && currentSession.linearIssueUrls.length > 0) {
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              threadTs,
              text: `<@${currentSession.initiatorId}> Planning complete!`,
              blocks: formatCompletionMessage(currentSession.linearIssueUrls, currentSession.initiatorId),
            }),
          );
          // Don't close - wait for user choice
        } else {
          store.close(threadTs);
        }
      }
      break;
    }

    case "timeout": {
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Interview timed out.`,
          blocks: formatTimeoutMessage(userId),
        }),
      );
      store.close(threadTs);
      break;
    }
  }
}

/**
 * Register the @mention handler for distributed mode
 */
export function registerMentionHandlerDistributed(
  app: App,
  store: InterviewStore,
  workerProxy: WorkerProxy,
  slackService: SlackService,
): void {
  app.event("app_mention", async ({ event, context, say }) => {
    const mentionEvent = event as AppMentionEvent;
    const channel = mentionEvent.channel;
    const messageTs = mentionEvent.ts;
    const userId = mentionEvent.user;
    const text = mentionEvent.text;
    const threadTsFromEvent = mentionEvent.thread_ts;
    const botUserId = context.botUserId || "";

    // Validate required fields
    if (!userId) {
      console.error("[MentionHandler] Missing user ID in mention event");
      return;
    }

    console.log(
      `[MentionHandler] Received mention from ${userId} in ${channel}`,
    );

    // Use the original message ts as thread, or if already in thread, use existing thread_ts
    const threadTs = threadTsFromEvent || messageTs;

    // Run the handler logic as an Effect
    await runHandlerEffect(
      Effect.gen(function* () {
        // Check for existing session in this thread
        if (store.has(threadTs)) {
          const existingSession = store.get(threadTs);

          // If session is in error or completed state, close it and allow new session
          if (existingSession && (existingSession.phase === "error" || existingSession.phase === "completed")) {
            console.log(`[MentionHandler] Closing stale session ${threadTs} (phase: ${existingSession.phase})`);
            store.close(threadTs);
            // Fall through to create new session
          } else if (existingSession) {
            // Check if user is the initiator
            if (!store.isInitiator(threadTs, userId)) {
              console.log(`[MentionHandler] Non-initiator @mention, ignoring`);
              return;
            }

            // Check if session has an active worker or is orphaned
            if (workerProxy.isSessionOrphaned(threadTs)) {
              console.log(`[MentionHandler] Session ${threadTs} is orphaned, attempting to resume`);

              // Extract the message text for the resume
              const messageText = extractDescription(text, botUserId);
              const resumePrompt = messageText || existingSession.initialDescription || "Continue the conversation";

              // Try to resume with a new worker
              const result = yield* workerProxy.resumeSession(
                threadTs,
                channel,
                userId,
                resumePrompt,
                async (event: WorkerInterviewEvent) => {
                  await handleWorkerInterviewEvent(
                    event,
                    threadTs,
                    channel,
                    store,
                    slackService,
                  );
                },
                existingSession.mode !== "greeting" ? existingSession.mode : "plan",
                existingSession.linearIssueUrls,
                store,
              ).pipe(
                Effect.catchTag("WorkerProxyError", (error) =>
                  Effect.gen(function* () {
                    console.error(`[MentionHandler] Failed to resume session: ${error.message}`);
                    yield* slackService.postMessage({
                      channel,
                      threadTs,
                      text: `<@${userId}> Failed to resume: ${error.message}`,
                      blocks: formatErrorMessage(error.message, userId),
                    });
                    return undefined;
                  }),
                ),
              );

              if (result) {
                // Update session with new worker
                store.setWorkerId(threadTs, result.workerId);
                store.setPhase(threadTs, "problem");

                // Add thinking indicator
                yield* slackService.addReaction(channel, messageTs, "thinking_face");
              }
              return;
            }

            // Active session with worker exists - treat this @mention as a follow-up message
            console.log(`[MentionHandler] Session exists for thread ${threadTs}, forwarding as message`);

            // Extract the message text (without the @mention)
            const messageText = extractDescription(text, botUserId);
            if (messageText) {
              // Update activity timestamp
              store.touch(threadTs);

              // Send as follow-up message to worker
              workerProxy.sendMessage(threadTs, messageText);

              // Add thinking indicator
              yield* slackService.addReaction(channel, messageTs, "thinking_face");
            }
            return;
          }
        }

        // Extract description from mention
        const description = extractDescription(text, botUserId);
        console.log(`[MentionHandler] Description: "${description || "(none)"}"`);

        // Try to extract project name from description for routing
        const projectName = extractProjectName(description);
        if (projectName) {
          console.log(`[MentionHandler] Detected project: "${projectName}"`);
        }

        // Create new session
        const _session = store.create(threadTs, channel, userId, description);

        // Set up timeout handler
        store.onTimeout(threadTs, async (timedOutSession) => {
          console.log(`[MentionHandler] Session ${threadTs} timed out`);
          workerProxy.cancelSession(threadTs, "timeout");
          await Effect.runPromise(
            slackService.postMessage({
              channel: timedOutSession.channel,
              text: `<@${timedOutSession.initiatorId}> Interview timed out after 30 minutes of inactivity.`,
              blocks: formatTimeoutMessage(timedOutSession.initiatorId),
            }),
          );
          store.close(threadTs);
        });

        // Don't post welcome message - wait for Claude's first response
        // This avoids the "Starting Planning Interview" message appearing before Claude responds

        // Start interview via worker
        store.setPhase(threadTs, "problem");

        const result = yield* workerProxy.startInterview(
          threadTs,
          channel,
          userId,
          description,
          async (event: WorkerInterviewEvent) => {
            await handleWorkerInterviewEvent(
              event,
              threadTs,
              channel,
              store,
              slackService,
            );
          },
          projectName, // Pass detected project for routing
          undefined, // mode
          undefined, // linearIssueUrls
          store, // Pass store for tracking originalWorkerId
        ).pipe(
          Effect.catchTag("WorkerProxyError", (error) =>
            Effect.gen(function* () {
              console.error(`[MentionHandler] Failed to start interview:`, error.message);
              store.setError(threadTs, error.message);

              yield* slackService.postMessage({
                channel,
                text: `<@${userId}> Failed to start interview: ${error.message}`,
                blocks: formatErrorMessage(error.message, userId),
              });

              store.close(threadTs);
              return undefined;
            }),
          ),
        );

        if (result) {
          // Store worker ID in session
          store.setWorkerId(threadTs, result.workerId);
        }
      }),
      "app_mention",
    );
  });
}

/**
 * Handle events from worker interview
 * Exported for use by message-handler when resuming orphaned sessions
 */
export async function handleWorkerInterviewEvent(
  event: WorkerInterviewEvent,
  threadTs: string,
  channel: string,
  store: InterviewStore,
  slackService: SlackService,
): Promise<void> {
  console.log(`[MentionHandler] Worker event: ${event.type}`);

  const payload = event.payload;

  // Get userId from session for tagging
  const session = store.get(threadTs);
  const userId = session?.initiatorId;

  switch (payload.type) {
    case "session_started": {
      // Session started with Claude CLI session ID
      // This is handled internally by WorkerProxy, no Slack message needed
      console.log(
        `[MentionHandler] Session ${threadTs} started with Claude session: ${payload.claudeSessionId}`,
      );
      break;
    }

    case "question": {
      // Store pending question
      store.setPendingQuestion(threadTs, payload.data, payload.data.toolUseID);

      // Post question to Slack thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Please answer the following question:`,
          blocks: formatQuestionData(payload.data, userId),
        }),
      );
      break;
    }

    case "phase_change": {
      store.setPhase(threadTs, payload.phase);

      // Post phase indicator to thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Phase: ${payload.phase}`,
          blocks: formatPhaseIndicator(payload.phase, userId),
        }),
      );
      break;
    }

    case "text": {
      // Post text content to thread
      const formattedText = formatMarkdown(payload.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> ${payload.content.substring(0, 200)}...`,
          blocks: [section(`<@${userId}> ${formattedText}`)],
        }),
      );
      break;
    }

    case "plan_ready": {
      store.setPhase(threadTs, "reviewing");
      store.setPlanContent(threadTs, payload.content);

      // Post plan preview to thread
      const formattedPlan = formatMarkdown(payload.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Plan ready for review`,
          blocks: [
            section(`<@${userId}> *Plan Ready for Review*`),
            section(formattedPlan.substring(0, 2900)),
          ],
        }),
      );
      break;
    }

    case "issues_created": {
      store.setPhase(threadTs, "completed");
      for (const url of payload.urls) {
        store.addLinearIssueUrl(threadTs, url);
      }

      // Post completion message to thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Planning complete! Issues created.`,
          blocks: formatCompletionMessage(payload.urls, userId),
        }),
      );

      // Don't close session yet - wait for user to choose mode
      break;
    }

    case "pr_created": {
      // Store the PR URL
      store.setPrUrl(threadTs, payload.url);

      // Post PR link to thread
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> PR created: ${payload.url}`,
          blocks: [
            section(`<@${userId}> :rocket: *Pull Request Created*`),
            section(`<${payload.url}|View PR on GitHub>`),
          ],
        })
      );
      break;
    }

    case "error": {
      store.setError(threadTs, payload.message);

      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Error: ${payload.message}`,
          blocks: formatErrorMessage(payload.message, userId),
        }),
      );
      break;
    }

    case "complete": {
      const currentSession = store.get(threadTs);
      if (
        currentSession &&
        currentSession.phase !== "completed" &&
        currentSession.phase !== "error"
      ) {
        store.setPhase(threadTs, "completed");
        const initiatorId = currentSession.initiatorId;

        if (currentSession.mode === "build") {
          // Offer review mode after build completes
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              threadTs,
              text: `<@${initiatorId}> Build complete! Ready for review?`,
              blocks: formatCompletionMessage(currentSession.linearIssueUrls ?? [], initiatorId),
            }),
          );
          // Don't close session yet - wait for user choice
        } else if (currentSession.mode === "review") {
          // Review complete - show summary and close
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              threadTs,
              text: `<@${initiatorId}> Review complete!`,
              blocks: [section(`<@${initiatorId}> *Review Complete*\nAll verification phases finished. Check Linear for any created tasks.`)],
            })
          );
          store.close(threadTs);
        } else {
          // Plan complete - if we have Linear URLs, show them with transition buttons
          if (currentSession.linearIssueUrls && currentSession.linearIssueUrls.length > 0) {
            await Effect.runPromise(
              slackService.postMessage({
                channel,
                threadTs,
                text: `<@${initiatorId}> Planning complete!`,
                blocks: [
                  ...formatCompletionMessage(currentSession.linearIssueUrls ?? [], initiatorId),
                  {
                    type: "actions",
                    block_id: `mode_transition_${threadTs}`,
                    elements: [
                      {
                        type: "button",
                        text: { type: "plain_text", text: "Start Building", emoji: true },
                        style: "primary",
                        action_id: "start_build_mode",
                        value: JSON.stringify({ threadTs, channel, urls: currentSession.linearIssueUrls }),
                      },
                      {
                        type: "button",
                        text: { type: "plain_text", text: "Done for Now", emoji: true },
                        action_id: "session_done",
                        value: threadTs,
                      },
                    ],
                  },
                ],
              })
            );
            // Don't close - wait for user choice
          } else {
            store.close(threadTs);
          }
        }
      }
      break;
    }

    case "timeout": {
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          threadTs,
          text: `<@${userId}> Interview timed out.`,
          blocks: formatTimeoutMessage(userId),
        }),
      );
      store.close(threadTs);
      break;
    }
  }
}
