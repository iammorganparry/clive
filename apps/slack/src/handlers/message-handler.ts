/**
 * Message Handler
 *
 * Handles thread replies from users during planning interviews.
 * Routes text answers to Claude for free-form responses.
 * Supports both local (ClaudeManager) and distributed (WorkerProxy) modes.
 */

import type { InterviewEvent as WorkerInterviewEvent } from "@clive/worker-protocol";
import type { App } from "@slack/bolt";
import type { MessageEvent } from "@slack/types";
import { Effect } from "effect";
import { formatErrorMessage, formatNonInitiatorNotice } from "../formatters/question-formatter";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";
import { handleWorkerInterviewEvent } from "./mention-handler";

/**
 * Register message handler for thread replies
 */
export function registerMessageHandler(
  app: App,
  store: InterviewStore,
  claudeManager: ClaudeManager,
  slackService: SlackService,
): void {
  // Handle messages in threads (replies)
  app.message(async ({ message }) => {
    // Type guard for message with expected properties
    const msg = message as MessageEvent & {
      subtype?: string;
      thread_ts?: string;
      bot_id?: string;
      user?: string;
      text?: string;
      ts: string;
      channel: string;
    };

    // Debug: Log all incoming messages
    console.log(`[MessageHandler] Received message event:`, {
      hasSubtype: !!msg.subtype,
      subtype: msg.subtype,
      hasThreadTs: !!msg.thread_ts,
      threadTs: msg.thread_ts,
      hasBotId: !!msg.bot_id,
      user: msg.user,
      textPreview: msg.text?.substring(0, 50),
    });

    // Only handle regular user messages (not bot messages, not edits)
    if (msg.subtype || !msg.thread_ts || msg.bot_id) {
      console.log(`[MessageHandler] Skipping message: subtype=${msg.subtype}, thread_ts=${msg.thread_ts}, bot_id=${msg.bot_id}`);
      return;
    }

    const channel = msg.channel;
    const threadTs = msg.thread_ts;
    const userId = msg.user;
    const text = msg.text;

    if (!userId || !text) {
      return;
    }

    // Check if this thread has an active interview
    if (!store.has(threadTs)) {
      console.log(`[MessageHandler] No active session for thread ${threadTs}, ignoring`);
      return;
    }

    console.log(`[MessageHandler] Thread reply from ${userId} in ${threadTs} - session found!`);

    // Check if user is the initiator
    if (!store.isInitiator(threadTs, userId)) {
      console.log(`[MessageHandler] Non-initiator reply, sending notice`);
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "This interview can only be answered by the person who started it.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    // Update activity timestamp
    store.touch(threadTs);

    const session = store.get(threadTs);
    if (!session) {
      return;
    }

    // If there's a pending question, treat this as an "Other" response
    if (session.pendingQuestion && session.pendingToolUseId && text) {
      console.log(`[MessageHandler] Text reply for pending question`);

      // Get the first question's header (for "Other" response)
      const firstQuestion = session.pendingQuestion.questions[0];
      if (firstQuestion) {
        // Record the answer
        store.recordAnswer(threadTs, firstQuestion.header, text);

        // Get answer payload
        const answerPayload = store.getAnswerPayload(threadTs);
        if (answerPayload) {
          // Send to Claude
          claudeManager.sendAnswer(
            threadTs,
            session.pendingToolUseId,
            answerPayload,
          );

          // Clear pending question
          store.clearPendingQuestion(threadTs);

          // Acknowledge the answer
          await Effect.runPromise(
            slackService.addReaction(channel, msg.ts, "white_check_mark"),
          );
        }
      }
    } else if (text) {
      // No pending question - send as follow-up message
      console.log(
        `[MessageHandler] Follow-up message: ${text.substring(0, 50)}...`,
      );

      // Check if in greeting mode and user wants to start planning
      if (session.mode === "greeting") {
        // Detect planning intent from user message
        const planningKeywords = [
          "build", "create", "add", "implement", "make", "develop",
          "feature", "fix", "bug", "issue", "problem", "plan",
          "want to", "need to", "let's", "can you", "help me"
        ];
        const lowerText = text.toLowerCase();
        const hasPlanningIntent = planningKeywords.some(keyword =>
          lowerText.includes(keyword)
        );

        if (hasPlanningIntent) {
          console.log(`[MessageHandler] Planning intent detected, transitioning to plan mode`);
          store.setMode(threadTs, "plan");
          store.setPhase(threadTs, "problem");
        }
      }

      // Send message to Claude
      claudeManager.sendMessage(threadTs, text);

      // Add thinking indicator
      await Effect.runPromise(
        slackService.addReaction(channel, msg.ts, "thinking_face"),
      );
    }
  });
}

/**
 * Register message handler for thread replies (distributed mode)
 */
export function registerMessageHandlerDistributed(
  app: App,
  store: InterviewStore,
  workerProxy: WorkerProxy,
  slackService: SlackService,
): void {
  app.message(async ({ message }) => {
    const msg = message as MessageEvent & {
      subtype?: string;
      thread_ts?: string;
      bot_id?: string;
      user?: string;
      text?: string;
      ts: string;
      channel: string;
    };

    // Debug: Log all incoming messages
    console.log(`[MessageHandler] Received message event:`, {
      hasSubtype: !!msg.subtype,
      subtype: msg.subtype,
      hasThreadTs: !!msg.thread_ts,
      threadTs: msg.thread_ts,
      hasBotId: !!msg.bot_id,
      user: msg.user,
      textPreview: msg.text?.substring(0, 50),
    });

    // Only handle regular user messages (not bot messages, not edits)
    if (msg.subtype || !msg.thread_ts || msg.bot_id) {
      console.log(`[MessageHandler] Skipping message: subtype=${msg.subtype}, thread_ts=${msg.thread_ts}, bot_id=${msg.bot_id}`);
      return;
    }

    const channel = msg.channel;
    const threadTs = msg.thread_ts;
    const userId = msg.user;
    const text = msg.text;

    if (!userId || !text) {
      return;
    }

    // Check if this thread has an active interview
    if (!store.has(threadTs)) {
      console.log(`[MessageHandler] No active session for thread ${threadTs}, ignoring`);
      return;
    }

    console.log(`[MessageHandler] Thread reply from ${userId} in ${threadTs} - session found!`);

    // Check if user is the initiator
    if (!store.isInitiator(threadTs, userId)) {
      console.log(`[MessageHandler] Non-initiator reply, sending notice`);
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "This interview can only be answered by the person who started it.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    // Update activity timestamp
    store.touch(threadTs);

    const session = store.get(threadTs);
    if (!session) {
      return;
    }

    // Check if session is orphaned (no active worker) and try to resume
    if (workerProxy.isSessionOrphaned(threadTs)) {
      console.log(`[MessageHandler] Session ${threadTs} is orphaned, attempting to resume`);

      const resumePrompt = text || session.initialDescription || "Continue the conversation";

      const result = await workerProxy.resumeSession(
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
        session.mode !== "greeting" ? session.mode : "plan",
        session.linearIssueUrls,
      );

      if ("error" in result) {
        console.error(`[MessageHandler] Failed to resume session: ${result.error}`);
        await Effect.runPromise(
          slackService.postMessage({
            channel,
            threadTs,
            text: `<@${userId}> Failed to resume: ${result.error}`,
            blocks: formatErrorMessage(result.error, userId),
          }),
        );
        return;
      }

      // Update session with new worker
      store.setWorkerId(threadTs, result.workerId);

      // Add thinking indicator
      await Effect.runPromise(
        slackService.addReaction(channel, msg.ts, "thinking_face"),
      );
      return;
    }

    // If there's a pending question, treat this as an "Other" response
    if (session.pendingQuestion && session.pendingToolUseId && text) {
      console.log(`[MessageHandler] Text reply for pending question`);

      // Get the first question's header (for "Other" response)
      const firstQuestion = session.pendingQuestion.questions[0];
      if (firstQuestion) {
        // Record the answer
        store.recordAnswer(threadTs, firstQuestion.header, text);

        // Get answer payload
        const answerPayload = store.getAnswerPayload(threadTs);
        if (answerPayload) {
          // Send to worker
          workerProxy.sendAnswer(
            threadTs,
            session.pendingToolUseId,
            answerPayload,
          );

          // Clear pending question
          store.clearPendingQuestion(threadTs);

          // Acknowledge the answer
          await Effect.runPromise(
            slackService.addReaction(channel, msg.ts, "white_check_mark"),
          );
        }
      }
    } else if (text) {
      // No pending question - send as follow-up message
      console.log(
        `[MessageHandler] Follow-up message: ${text.substring(0, 50)}...`,
      );

      // Check if in greeting mode and user wants to start planning
      if (session.mode === "greeting") {
        // Detect planning intent from user message
        const planningKeywords = [
          "build", "create", "add", "implement", "make", "develop",
          "feature", "fix", "bug", "issue", "problem", "plan",
          "want to", "need to", "let's", "can you", "help me"
        ];
        const lowerText = text.toLowerCase();
        const hasPlanningIntent = planningKeywords.some(keyword =>
          lowerText.includes(keyword)
        );

        if (hasPlanningIntent) {
          console.log(`[MessageHandler] Planning intent detected, transitioning to plan mode`);
          store.setMode(threadTs, "plan");
          store.setPhase(threadTs, "problem");
        }
      }

      // Send message to worker
      workerProxy.sendMessage(threadTs, text);

      // Add thinking indicator
      await Effect.runPromise(
        slackService.addReaction(channel, msg.ts, "thinking_face"),
      );
    }
  });
}
