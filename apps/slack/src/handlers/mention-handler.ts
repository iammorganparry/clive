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
  formatWelcomeMessage,
} from "../formatters/question-formatter";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";
import type { InterviewEvent } from "../store/types";

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
      console.log(
        `[MentionHandler] Session already exists for thread ${threadTs}`,
      );
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "An interview is already in progress in this thread. Please continue answering questions or wait for it to complete.",
          threadTs,
        }),
      );
      return;
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
          text: "Interview timed out after 30 minutes of inactivity.",
          threadTs: timedOutSession.threadTs,
          blocks: formatTimeoutMessage(),
        }),
      );
      store.close(threadTs);
    });

    // Post welcome message
    await Effect.runPromise(
      slackService.postMessage({
        channel,
        text: "Starting planning interview...",
        threadTs,
        blocks: formatWelcomeMessage(!!description),
      }),
    );

    // Start Claude interview
    try {
      store.setPhase(threadTs, "problem");

      const handle = await claudeManager.startInterview(
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
      );

      store.setClaudeHandle(threadTs, handle);
    } catch (error) {
      console.error(`[MentionHandler] Failed to start interview:`, error);
      store.setError(threadTs, String(error));

      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `Failed to start interview: ${error}`,
          threadTs,
          blocks: formatErrorMessage(String(error)),
        }),
      );

      store.close(threadTs);
    }
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

  switch (event.type) {
    case "question": {
      // Store pending question
      store.setPendingQuestion(threadTs, event.data, event.data.toolUseID);

      // Post question to Slack
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Please answer the following question:",
          threadTs,
          blocks: formatQuestionData(event.data),
        }),
      );
      break;
    }

    case "phase_change": {
      store.setPhase(threadTs, event.phase);

      // Post phase indicator
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `Phase: ${event.phase}`,
          threadTs,
          blocks: formatPhaseIndicator(event.phase),
        }),
      );
      break;
    }

    case "text": {
      // Post text content (plan, explanations, etc.)
      const formattedText = formatMarkdown(event.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `${event.content.substring(0, 200)}...`,
          threadTs,
          blocks: [section(formattedText)],
        }),
      );
      break;
    }

    case "plan_ready": {
      store.setPhase(threadTs, "reviewing");
      store.setPlanContent(threadTs, event.content);

      // Post plan preview with approval buttons
      const formattedPlan = formatMarkdown(event.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Plan ready for review",
          threadTs,
          blocks: [
            section("*Plan Ready for Review*"),
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

      // Post completion message with links
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Planning complete! Issues created.",
          threadTs,
          blocks: formatCompletionMessage(event.urls),
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
          text: `Error: ${event.message}`,
          threadTs,
          blocks: formatErrorMessage(event.message),
        }),
      );
      break;
    }

    case "complete": {
      const session = store.get(threadTs);
      if (
        session &&
        session.phase !== "completed" &&
        session.phase !== "error"
      ) {
        store.setPhase(threadTs, "completed");

        // If we have Linear URLs, show them with build transition
        if (session.linearIssueUrls && session.linearIssueUrls.length > 0) {
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              text: "Planning complete!",
              threadTs,
              blocks: formatCompletionMessage(session.linearIssueUrls),
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
          text: "Interview timed out.",
          threadTs,
          blocks: formatTimeoutMessage(),
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

    // Check for existing session in this thread
    if (store.has(threadTs)) {
      console.log(
        `[MentionHandler] Session already exists for thread ${threadTs}`,
      );
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "An interview is already in progress in this thread. Please continue answering questions or wait for it to complete.",
          threadTs,
        }),
      );
      return;
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
          text: "Interview timed out after 30 minutes of inactivity.",
          threadTs: timedOutSession.threadTs,
          blocks: formatTimeoutMessage(),
        }),
      );
      store.close(threadTs);
    });

    // Post welcome message
    await Effect.runPromise(
      slackService.postMessage({
        channel,
        text: "Starting planning interview...",
        threadTs,
        blocks: formatWelcomeMessage(!!description),
      }),
    );

    // Start interview via worker
    try {
      store.setPhase(threadTs, "problem");

      const result = await workerProxy.startInterview(
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
      );

      if ("error" in result) {
        throw new Error(result.error);
      }

      // Store worker ID in session
      store.setWorkerId(threadTs, result.workerId);
    } catch (error) {
      console.error(`[MentionHandler] Failed to start interview:`, error);
      store.setError(threadTs, String(error));

      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `Failed to start interview: ${error}`,
          threadTs,
          blocks: formatErrorMessage(String(error)),
        }),
      );

      store.close(threadTs);
    }
  });
}

/**
 * Handle events from worker interview
 */
async function handleWorkerInterviewEvent(
  event: WorkerInterviewEvent,
  threadTs: string,
  channel: string,
  store: InterviewStore,
  slackService: SlackService,
): Promise<void> {
  console.log(`[MentionHandler] Worker event: ${event.type}`);

  const payload = event.payload;

  switch (payload.type) {
    case "question": {
      // Store pending question
      store.setPendingQuestion(threadTs, payload.data, payload.data.toolUseID);

      // Post question to Slack
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Please answer the following question:",
          threadTs,
          blocks: formatQuestionData(payload.data),
        }),
      );
      break;
    }

    case "phase_change": {
      store.setPhase(threadTs, payload.phase);

      // Post phase indicator
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `Phase: ${payload.phase}`,
          threadTs,
          blocks: formatPhaseIndicator(payload.phase),
        }),
      );
      break;
    }

    case "text": {
      // Post text content (plan, explanations, etc.)
      const formattedText = formatMarkdown(payload.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `${payload.content.substring(0, 200)}...`,
          threadTs,
          blocks: [section(formattedText)],
        }),
      );
      break;
    }

    case "plan_ready": {
      store.setPhase(threadTs, "reviewing");
      store.setPlanContent(threadTs, payload.content);

      // Post plan preview
      const formattedPlan = formatMarkdown(payload.content);
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Plan ready for review",
          threadTs,
          blocks: [
            section("*Plan Ready for Review*"),
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

      // Post completion message with mode transition buttons
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: "Planning complete! Issues created.",
          threadTs,
          blocks: formatCompletionMessage(payload.urls),
        }),
      );

      // Don't close session yet - wait for user to choose mode
      break;
    }

    case "pr_created": {
      // Store the PR URL
      store.setPrUrl(threadTs, payload.url);

      // Post PR link to Slack
      await Effect.runPromise(
        slackService.postMessage({
          channel,
          text: `PR created: ${payload.url}`,
          threadTs,
          blocks: [
            section(`:rocket: *Pull Request Created*`),
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
          text: `Error: ${payload.message}`,
          threadTs,
          blocks: formatErrorMessage(payload.message),
        }),
      );
      break;
    }

    case "complete": {
      const session = store.get(threadTs);
      if (
        session &&
        session.phase !== "completed" &&
        session.phase !== "error"
      ) {
        store.setPhase(threadTs, "completed");

        if (session.mode === "build") {
          // Build PR info block if we have a PR
          const prBlock = session.prUrl
            ? section(`:white_check_mark: *PR:* <${session.prUrl}|View on GitHub>`)
            : section(`:information_source: No PR was created (possibly working on branch)`);

          // Offer review mode after build completes
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              text: "Build complete! Ready for review?",
              threadTs,
              blocks: formatCompletionMessage(session.linearIssueUrls),
            }),
          );
          // Don't close session yet - wait for user choice
        } else if (session.mode === "review") {
          // Review complete - show summary and close
          await Effect.runPromise(
            slackService.postMessage({
              channel,
              text: "Review complete!",
              threadTs,
              blocks: [section("*Review Complete*\nAll verification phases finished. Check Linear for any created tasks.")],
            })
          );
          store.close(threadTs);
        } else {
          // Plan complete - if we have Linear URLs, show them with transition buttons
          if (session.linearIssueUrls && session.linearIssueUrls.length > 0) {
            await Effect.runPromise(
              slackService.postMessage({
                channel,
                text: "Planning complete!",
                threadTs,
                blocks: [
                  ...formatCompletionMessage(session.linearIssueUrls),
                  {
                    type: "actions",
                    block_id: `mode_transition_${threadTs}`,
                    elements: [
                      {
                        type: "button",
                        text: { type: "plain_text", text: "Start Building", emoji: true },
                        style: "primary",
                        action_id: "start_build_mode",
                        value: JSON.stringify({ threadTs, channel, urls: session.linearIssueUrls }),
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
          text: "Interview timed out.",
          threadTs,
          blocks: formatTimeoutMessage(),
        }),
      );
      store.close(threadTs);
      break;
    }
  }
}
