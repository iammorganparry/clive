/**
 * Action Handler
 *
 * Handles button clicks and modal submissions during planning interviews.
 * Supports both local (ClaudeManager) and distributed (WorkerProxy) modes.
 */

import type { App, BlockAction, ButtonAction } from "@slack/bolt";
import { Effect } from "effect";
import { otherInputModal, section } from "../formatters/block-builder";
import {
  ACTION_IDS,
  formatNonInitiatorNotice,
} from "../formatters/question-formatter";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";

/**
 * Parse action value JSON safely
 */
function parseActionValue(
  value: string | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/**
 * Register action handlers for button clicks and modal submissions
 */
export function registerActionHandler(
  app: App,
  store: InterviewStore,
  claudeManager: ClaudeManager,
  slackService: SlackService,
): void {
  // Handle option button clicks (question_option_*)
  app.action(
    new RegExp(`^${ACTION_IDS.OPTION_PREFIX}`),
    async ({ body, ack, respond }) => {
      await ack();

      const action = (body as BlockAction).actions[0] as ButtonAction;
      const userId = body.user.id;
      const actionValue = parseActionValue(action.value);

      if (!actionValue) {
        console.error("[ActionHandler] Invalid action value");
        return;
      }

      const { toolUseId, header, label } = actionValue as {
        toolUseId: string;
        questionIndex: number;
        optionIndex: number;
        header: string;
        label: string;
      };

      // Find the thread from the message
      const message = (body as BlockAction).message;
      const threadTs = message?.thread_ts || message?.ts;

      if (!threadTs || typeof threadTs !== "string") {
        console.error("[ActionHandler] Could not determine thread");
        return;
      }

      const channel = (body as BlockAction).channel?.id;
      if (!channel) {
        console.error("[ActionHandler] Could not determine channel");
        return;
      }

      console.log(`[ActionHandler] Option selected: ${label} for ${header}`);

      // Check if user is initiator
      if (!store.isInitiator(threadTs, userId)) {
        const session = store.get(threadTs);
        if (session) {
          await Effect.runPromise(
            slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can answer questions.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            }),
          );
        }
        return;
      }

      // Update activity
      store.touch(threadTs);

      // Record the answer
      store.recordAnswer(threadTs, header, label);

      // Get full answer payload
      const answerPayload = store.getAnswerPayload(threadTs);
      const session = store.get(threadTs);

      if (answerPayload && session?.pendingToolUseId) {
        // Send answer to Claude
        claudeManager.sendAnswer(
          threadTs,
          session.pendingToolUseId,
          answerPayload,
        );

        // Clear pending question
        store.clearPendingQuestion(threadTs);

        // Update the message to show selection
        if (respond) {
          await respond({
            replace_original: true,
            text: `Selected: ${label}`,
            blocks: [section(`:white_check_mark: *${header}:* ${label}`)],
          });
        }
      }
    },
  );

  // Handle "Other..." button click
  app.action(ACTION_IDS.OTHER, async ({ body, ack, client }) => {
    await ack();

    const action = (body as BlockAction).actions[0] as ButtonAction;
    const triggerId = (body as BlockAction).trigger_id;
    const actionValue = parseActionValue(action.value);

    if (!actionValue || !triggerId) {
      return;
    }

    const { toolUseId, header, question } = actionValue as {
      toolUseId: string;
      questionIndex: number;
      header: string;
      question: string;
    };

    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;

    if (!threadTs || typeof threadTs !== "string") {
      return;
    }

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const channel = (body as BlockAction).channel?.id;
      if (channel) {
        const session = store.get(threadTs);
        if (session) {
          await Effect.runPromise(
            slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can answer questions.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            }),
          );
        }
      }
      return;
    }

    // Open modal for custom input
    const modal = otherInputModal(header, question, threadTs, toolUseId);
    await client.views.open({
      trigger_id: triggerId,
      view: modal as any,
    });
  });

  // Handle modal submission for custom "Other" input
  app.view("other_input_modal", async ({ body, ack, view }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata || "{}");
    const { threadTs, toolUseId, questionHeader } = metadata as {
      threadTs: string;
      toolUseId: string;
      questionHeader: string;
    };

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the custom answer from the input
    const customAnswer =
      view.state.values.custom_answer_block?.custom_answer_input?.value;

    if (!customAnswer) {
      return;
    }

    console.log(
      `[ActionHandler] Custom answer for ${questionHeader}: ${customAnswer.substring(0, 50)}...`,
    );

    // Update activity
    store.touch(threadTs);

    // Record the answer
    store.recordAnswer(threadTs, questionHeader, customAnswer);

    // Get full answer payload
    const answerPayload = store.getAnswerPayload(threadTs);
    const session = store.get(threadTs);

    if (answerPayload && session?.pendingToolUseId) {
      // Send answer to Claude
      claudeManager.sendAnswer(
        threadTs,
        session.pendingToolUseId,
        answerPayload,
      );

      // Clear pending question
      store.clearPendingQuestion(threadTs);
    }
  });

  // Handle plan approval
  app.action(ACTION_IDS.APPROVE_PLAN, async ({ body, ack, respond }) => {
    await ack();

    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;
    const userId = body.user.id;
    const channel = (body as BlockAction).channel?.id;

    if (!threadTs || typeof threadTs !== "string" || !channel) {
      return;
    }

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "Only the interview initiator can approve the plan.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    console.log(`[ActionHandler] Plan approved by ${userId}`);

    // Update activity
    store.touch(threadTs);
    store.setPhase(threadTs, "creating_issues");

    // Update message
    if (respond) {
      await respond({
        replace_original: true,
        text: "Plan approved! Creating Linear issues...",
        blocks: [
          section(":hourglass_flowing_sand: *Creating Linear issues...*"),
        ],
      });
    }

    // Send approval to Claude to create issues
    claudeManager.sendMessage(
      threadTs,
      "Approved. Please create the Linear issues now.",
    );
  });

  // Handle request changes
  app.action(ACTION_IDS.REQUEST_CHANGES, async ({ body, ack, client }) => {
    await ack();

    const triggerId = (body as BlockAction).trigger_id;
    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;
    const userId = body.user.id;
    const channel = (body as BlockAction).channel?.id;

    if (!threadTs || typeof threadTs !== "string" || !channel || !triggerId) {
      return;
    }

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "Only the interview initiator can request changes.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    // Open modal for change request
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "change_request_modal",
        private_metadata: JSON.stringify({ threadTs }),
        title: {
          type: "plain_text",
          text: "Request Changes",
        },
        submit: {
          type: "plain_text",
          text: "Submit",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "changes_block",
            element: {
              type: "plain_text_input",
              action_id: "changes_input",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Describe what changes you'd like to the plan...",
              },
            },
            label: {
              type: "plain_text",
              text: "Requested Changes",
            },
          },
        ],
      } as any,
    });
  });

  // Handle change request modal submission
  app.view("change_request_modal", async ({ body, ack, view }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata || "{}");
    const { threadTs } = metadata as { threadTs: string };
    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the change request
    const changeRequest = view.state.values.changes_block?.changes_input?.value;

    if (!changeRequest) {
      return;
    }

    console.log(
      `[ActionHandler] Change request: ${changeRequest.substring(0, 50)}...`,
    );

    // Update activity
    store.touch(threadTs);
    store.setPhase(threadTs, "generating");

    // Send change request to Claude
    claudeManager.sendMessage(
      threadTs,
      `Please revise the plan with these changes: ${changeRequest}`,
    );
  });
}

/**
 * Register action handlers for distributed mode
 */
export function registerActionHandlerDistributed(
  app: App,
  store: InterviewStore,
  workerProxy: WorkerProxy,
  slackService: SlackService,
): void {
  // Handle option button clicks (question_option_*)
  app.action(
    new RegExp(`^${ACTION_IDS.OPTION_PREFIX}`),
    async ({ body, ack, respond }) => {
      await ack();

      const action = (body as BlockAction).actions[0] as ButtonAction;
      const userId = body.user.id;
      const actionValue = parseActionValue(action.value);

      if (!actionValue) {
        console.error("[ActionHandler] Invalid action value");
        return;
      }

      const { toolUseId, header, label } = actionValue as {
        toolUseId: string;
        questionIndex: number;
        optionIndex: number;
        header: string;
        label: string;
      };

      // Find the thread from the message
      const message = (body as BlockAction).message;
      const threadTs = message?.thread_ts || message?.ts;

      if (!threadTs || typeof threadTs !== "string") {
        console.error("[ActionHandler] Could not determine thread");
        return;
      }

      const channel = (body as BlockAction).channel?.id;
      if (!channel) {
        console.error("[ActionHandler] Could not determine channel");
        return;
      }

      console.log(`[ActionHandler] Option selected: ${label} for ${header}`);

      // Check if user is initiator
      if (!store.isInitiator(threadTs, userId)) {
        const session = store.get(threadTs);
        if (session) {
          await Effect.runPromise(
            slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can answer questions.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            }),
          );
        }
        return;
      }

      // Update activity
      store.touch(threadTs);

      // Record the answer
      store.recordAnswer(threadTs, header, label);

      // Get full answer payload
      const answerPayload = store.getAnswerPayload(threadTs);
      const session = store.get(threadTs);

      if (answerPayload && session?.pendingToolUseId) {
        // Send answer to worker
        workerProxy.sendAnswer(
          threadTs,
          session.pendingToolUseId,
          answerPayload,
        );

        // Clear pending question
        store.clearPendingQuestion(threadTs);

        // Update the message to show selection
        if (respond) {
          await respond({
            replace_original: true,
            text: `Selected: ${label}`,
            blocks: [section(`:white_check_mark: *${header}:* ${label}`)],
          });
        }
      }
    },
  );

  // Handle "Other..." button click
  app.action(ACTION_IDS.OTHER, async ({ body, ack, client }) => {
    await ack();

    const action = (body as BlockAction).actions[0] as ButtonAction;
    const triggerId = (body as BlockAction).trigger_id;
    const actionValue = parseActionValue(action.value);

    if (!actionValue || !triggerId) {
      return;
    }

    const { toolUseId, header, question } = actionValue as {
      toolUseId: string;
      questionIndex: number;
      header: string;
      question: string;
    };

    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;

    if (!threadTs || typeof threadTs !== "string") {
      return;
    }

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const channel = (body as BlockAction).channel?.id;
      if (channel) {
        const session = store.get(threadTs);
        if (session) {
          await Effect.runPromise(
            slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can answer questions.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            }),
          );
        }
      }
      return;
    }

    // Open modal for custom input
    const modal = otherInputModal(header, question, threadTs, toolUseId);
    await client.views.open({
      trigger_id: triggerId,
      view: modal as any,
    });
  });

  // Handle modal submission for custom "Other" input
  app.view("other_input_modal", async ({ body, ack, view }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata || "{}");
    const { threadTs, toolUseId, questionHeader } = metadata as {
      threadTs: string;
      toolUseId: string;
      questionHeader: string;
    };

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the custom answer from the input
    const customAnswer =
      view.state.values.custom_answer_block?.custom_answer_input?.value;

    if (!customAnswer) {
      return;
    }

    console.log(
      `[ActionHandler] Custom answer for ${questionHeader}: ${customAnswer.substring(0, 50)}...`,
    );

    // Update activity
    store.touch(threadTs);

    // Record the answer
    store.recordAnswer(threadTs, questionHeader, customAnswer);

    // Get full answer payload
    const answerPayload = store.getAnswerPayload(threadTs);
    const session = store.get(threadTs);

    if (answerPayload && session?.pendingToolUseId) {
      // Send answer to worker
      workerProxy.sendAnswer(threadTs, session.pendingToolUseId, answerPayload);

      // Clear pending question
      store.clearPendingQuestion(threadTs);
    }
  });

  // Handle plan approval
  app.action(ACTION_IDS.APPROVE_PLAN, async ({ body, ack, respond }) => {
    await ack();

    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;
    const userId = body.user.id;
    const channel = (body as BlockAction).channel?.id;

    if (!threadTs || typeof threadTs !== "string" || !channel) {
      return;
    }

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "Only the interview initiator can approve the plan.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    console.log(`[ActionHandler] Plan approved by ${userId}`);

    // Update activity
    store.touch(threadTs);
    store.setPhase(threadTs, "creating_issues");

    // Update message
    if (respond) {
      await respond({
        replace_original: true,
        text: "Plan approved! Creating Linear issues...",
        blocks: [
          section(":hourglass_flowing_sand: *Creating Linear issues...*"),
        ],
      });
    }

    // Send approval to worker
    workerProxy.sendMessage(
      threadTs,
      "Approved. Please create the Linear issues now.",
    );
  });

  // Handle request changes
  app.action(ACTION_IDS.REQUEST_CHANGES, async ({ body, ack, client }) => {
    await ack();

    const triggerId = (body as BlockAction).trigger_id;
    const message = (body as BlockAction).message;
    const threadTs = message?.thread_ts || message?.ts;
    const userId = body.user.id;
    const channel = (body as BlockAction).channel?.id;

    if (!threadTs || typeof threadTs !== "string" || !channel || !triggerId) {
      return;
    }

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      const session = store.get(threadTs);
      if (session) {
        await Effect.runPromise(
          slackService.postEphemeral({
            channel,
            user: userId,
            text: "Only the interview initiator can request changes.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          }),
        );
      }
      return;
    }

    // Open modal for change request
    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "change_request_modal",
        private_metadata: JSON.stringify({ threadTs }),
        title: {
          type: "plain_text",
          text: "Request Changes",
        },
        submit: {
          type: "plain_text",
          text: "Submit",
        },
        close: {
          type: "plain_text",
          text: "Cancel",
        },
        blocks: [
          {
            type: "input",
            block_id: "changes_block",
            element: {
              type: "plain_text_input",
              action_id: "changes_input",
              multiline: true,
              placeholder: {
                type: "plain_text",
                text: "Describe what changes you'd like to the plan...",
              },
            },
            label: {
              type: "plain_text",
              text: "Requested Changes",
            },
          },
        ],
      } as any,
    });
  });

  // Handle change request modal submission
  app.view("change_request_modal", async ({ body, ack, view }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata || "{}");
    const { threadTs } = metadata as { threadTs: string };
    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the change request
    const changeRequest = view.state.values.changes_block?.changes_input?.value;

    if (!changeRequest) {
      return;
    }

    console.log(
      `[ActionHandler] Change request: ${changeRequest.substring(0, 50)}...`,
    );

    // Update activity
    store.touch(threadTs);
    store.setPhase(threadTs, "generating");

    // Send change request to worker
    workerProxy.sendMessage(
      threadTs,
      `Please revise the plan with these changes: ${changeRequest}`,
    );
  });
}
