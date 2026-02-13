/**
 * Action Handler
 *
 * Handles button clicks and modal submissions during planning interviews.
 * Supports both local (ClaudeManager) and distributed (WorkerProxy) modes.
 */

import type { App, BlockAction, ButtonAction } from "@slack/bolt";
import { Data, Effect } from "effect";
import {
  OtherInputModalMetadataSchema,
  ChangeRequestModalMetadataSchema,
  BuildModeActionMetadataSchema,
  ReviewModeActionMetadataSchema,
  MAX_USER_INPUT_LENGTH,
  BLOCKED_INPUT_PATTERNS,
} from "@clive/worker-protocol";
import { otherInputModal, section } from "../formatters/block-builder";

/**
 * Error when Slack API response fails
 */
export class SlackResponseError extends Data.TaggedError("SlackResponseError")<{
  message: string;
  cause?: unknown;
}> {}
import {
  ACTION_IDS,
  formatErrorMessage,
  formatNonInitiatorNotice,
} from "../formatters/question-formatter";
import { extractProjectName } from "./mention-handler";
import type { ClaudeManager } from "../services/claude-manager";
import type { SlackService } from "../services/slack-service";
import type { WorkerProxy } from "../services/worker-proxy";
import type { InterviewStore } from "../store/interview-store";
import { runHandlerEffect } from "./handler-utils";

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
 * Sanitize user input before sending to AI
 * SECURITY: Prevents prompt injection and limits input length
 */
function sanitizeUserInput(input: string): { valid: boolean; sanitized: string; error?: string } {
  // Truncate to max length
  const sanitized = input.slice(0, MAX_USER_INPUT_LENGTH);

  // Check for blocked patterns (potential prompt injection)
  for (const pattern of BLOCKED_INPUT_PATTERNS) {
    if (pattern.test(sanitized)) {
      console.warn("[ActionHandler] Blocked input pattern detected:", pattern.toString());
      return {
        valid: false,
        sanitized: "",
        error: "Input contains blocked content. Please rephrase your response.",
      };
    }
  }

  return { valid: true, sanitized };
}

/**
 * Parse and validate modal private_metadata with Zod schema
 * SECURITY: Validates structure to prevent injection attacks
 */
function parsePrivateMetadata<T>(
  privateMetadata: string | undefined,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: unknown } },
): T | null {
  if (!privateMetadata) return null;
  try {
    const parsed = JSON.parse(privateMetadata);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      console.error("[ActionHandler] Invalid private_metadata structure:", result.error);
      return null;
    }
    return result.data ?? null;
  } catch (error) {
    console.error("[ActionHandler] Failed to parse private_metadata:", error);
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

    // SECURITY: Validate private_metadata with Zod schema
    const metadata = parsePrivateMetadata(view.private_metadata, OtherInputModalMetadataSchema);
    if (!metadata) {
      console.error("[ActionHandler] Invalid other_input_modal metadata");
      return;
    }
    const { threadTs, questionHeader } = metadata;

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the custom answer from the input
    const rawAnswer =
      view.state.values.custom_answer_block?.custom_answer_input?.value;

    if (!rawAnswer) {
      return;
    }

    // SECURITY: Sanitize user input before sending to AI
    const { valid, sanitized: customAnswer, error } = sanitizeUserInput(rawAnswer);
    if (!valid) {
      console.warn(`[ActionHandler] Blocked custom answer: ${error}`);
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

  // Handle assistant feedback buttons (positive)
  app.action(
    /^assistant_feedback_positive/,
    async ({ ack }) => {
      await ack();
      console.log("[ActionHandler] Positive assistant feedback received");
    },
  );

  // Handle assistant feedback buttons (negative)
  app.action(
    /^assistant_feedback_negative/,
    async ({ ack }) => {
      await ack();
      console.log("[ActionHandler] Negative assistant feedback received");
    },
  );

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

    // SECURITY: Validate private_metadata with Zod schema
    const metadata = parsePrivateMetadata(view.private_metadata, ChangeRequestModalMetadataSchema);
    if (!metadata) {
      console.error("[ActionHandler] Invalid change_request_modal metadata");
      return;
    }
    const { threadTs } = metadata;
    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the change request
    const rawChangeRequest = view.state.values.changes_block?.changes_input?.value;

    if (!rawChangeRequest) {
      return;
    }

    // SECURITY: Sanitize user input before sending to AI
    const { valid, sanitized: changeRequest, error } = sanitizeUserInput(rawChangeRequest);
    if (!valid) {
      console.warn(`[ActionHandler] Blocked change request: ${error}`);
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

    // SECURITY: Validate private_metadata with Zod schema
    const metadata = parsePrivateMetadata(view.private_metadata, OtherInputModalMetadataSchema);
    if (!metadata) {
      console.error("[ActionHandler] Invalid other_input_modal metadata");
      return;
    }
    const { threadTs, questionHeader } = metadata;

    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the custom answer from the input
    const rawAnswer =
      view.state.values.custom_answer_block?.custom_answer_input?.value;

    if (!rawAnswer) {
      return;
    }

    // SECURITY: Sanitize user input before sending to AI
    const { valid, sanitized: customAnswer, error } = sanitizeUserInput(rawAnswer);
    if (!valid) {
      console.warn(`[ActionHandler] Blocked custom answer: ${error}`);
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

  // Handle assistant feedback buttons (positive)
  app.action(
    /^assistant_feedback_positive/,
    async ({ ack }) => {
      await ack();
      console.log("[ActionHandler] Positive assistant feedback received");
    },
  );

  // Handle assistant feedback buttons (negative)
  app.action(
    /^assistant_feedback_negative/,
    async ({ ack }) => {
      await ack();
      console.log("[ActionHandler] Negative assistant feedback received");
    },
  );

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

    // SECURITY: Validate private_metadata with Zod schema
    const metadata = parsePrivateMetadata(view.private_metadata, ChangeRequestModalMetadataSchema);
    if (!metadata) {
      console.error("[ActionHandler] Invalid change_request_modal metadata");
      return;
    }
    const { threadTs } = metadata;
    const userId = body.user.id;

    // Check if user is initiator
    if (!store.isInitiator(threadTs, userId)) {
      return;
    }

    // Get the change request
    const rawChangeRequest = view.state.values.changes_block?.changes_input?.value;

    if (!rawChangeRequest) {
      return;
    }

    // SECURITY: Sanitize user input before sending to AI
    const { valid, sanitized: changeRequest, error } = sanitizeUserInput(rawChangeRequest);
    if (!valid) {
      console.warn(`[ActionHandler] Blocked change request: ${error}`);
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

  // Handle "Start Building" button click for mode transition
  app.action("start_build_mode", async ({ body, ack, respond }) => {
    await ack();

    const action = (body as BlockAction).actions[0] as ButtonAction;
    const userId = body.user.id;
    const actionValue = parseActionValue(action.value);

    if (!actionValue) {
      console.error("[ActionHandler] Invalid action value for start_build_mode");
      return;
    }

    // SECURITY: Validate action value with Zod schema
    const parseResult = BuildModeActionMetadataSchema.safeParse(actionValue);
    if (!parseResult.success) {
      console.error("[ActionHandler] Invalid start_build_mode action value:", parseResult.error);
      return;
    }

    const { threadTs, channel, urls } = parseResult.data;

    // Run the handler logic as an Effect
    await runHandlerEffect(
      Effect.gen(function* () {
        // Check if user is initiator
        if (!store.isInitiator(threadTs, userId)) {
          const session = store.get(threadTs);
          if (session) {
            yield* slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can start build mode.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            });
          }
          return;
        }

        console.log(`[ActionHandler] Starting build mode for thread ${threadTs}`);

        // Update session mode
        store.setMode(threadTs, "build");
        store.setPhase(threadTs, "starting");

        // Extract parent issue (first URL, typically the epic)
        const parentIssueUrl = urls[0];

        // Build transition message blocks
        const transitionBlocks = [
          section(":hammer_and_wrench: *Starting Build Mode*"),
        ];

        // Show parent issue if we have one
        if (parentIssueUrl) {
          transitionBlocks.push(section(`:link: *Parent Issue:* <${parentIssueUrl}|View in Linear>`));
        }

        transitionBlocks.push(section("Executing tasks from Linear..."));

        // Update the message to show transition with parent issue
        if (respond) {
          yield* Effect.tryPromise({
            try: () =>
              respond({
                replace_original: true,
                text: "Starting build mode...",
                blocks: transitionBlocks,
              }),
            catch: (error) =>
              new SlackResponseError({
                message: `Failed to update Slack message: ${String(error)}`,
                cause: error,
              }),
          });
        }

        // Start build session via worker
        const session = store.get(threadTs);
        const result = yield* workerProxy.startInterview(
          `${threadTs}-build`,
          channel,
          userId,
          "Execute the next pending task from Claude Tasks.",
          async (event) => {
            // Forward events through existing handler - events will be handled by mention handler
            const pending = store.get(threadTs);
            if (pending) {
              store.touch(threadTs);
            }
          },
          session?.initialDescription ? extractProjectName(session.initialDescription) : undefined,
          "build",
          urls,
        ).pipe(
          Effect.catchTag("WorkerProxyError", (error) =>
            Effect.gen(function* () {
              console.error(`[ActionHandler] Failed to start build mode:`, error.message);
              yield* slackService.postMessage({
                channel,
                text: `<@${userId}> Failed to start build mode: ${error.message}`,
                blocks: formatErrorMessage(error.message, userId),
              });
              return undefined;
            }),
          ),
        );

        if (result && "workerId" in result) {
          store.setWorkerId(threadTs, result.workerId);
        }
      }),
      "start_build_mode",
    );
  });

  // Handle "Start Review" button click for mode transition
  app.action("start_review_mode", async ({ body, ack, respond }) => {
    await ack();

    const action = (body as BlockAction).actions[0] as ButtonAction;
    const userId = body.user.id;
    const actionValue = parseActionValue(action.value);

    if (!actionValue) {
      console.error("[ActionHandler] Invalid action value for start_review_mode");
      return;
    }

    // SECURITY: Validate action value with Zod schema
    const parseResult = ReviewModeActionMetadataSchema.safeParse(actionValue);
    if (!parseResult.success) {
      console.error("[ActionHandler] Invalid start_review_mode action value:", parseResult.error);
      return;
    }

    const { threadTs, channel, urls } = parseResult.data;

    // Run the handler logic as an Effect
    await runHandlerEffect(
      Effect.gen(function* () {
        // Check if user is initiator
        if (!store.isInitiator(threadTs, userId)) {
          const session = store.get(threadTs);
          if (session) {
            yield* slackService.postEphemeral({
              channel,
              user: userId,
              text: "Only the interview initiator can start review mode.",
              threadTs,
              blocks: formatNonInitiatorNotice(session.initiatorId),
            });
          }
          return;
        }

        console.log(`[ActionHandler] Starting review mode for thread ${threadTs}`);

        // Update session mode
        store.setMode(threadTs, "review");
        store.setPhase(threadTs, "starting");

        // Update the message to show transition
        if (respond) {
          yield* Effect.tryPromise({
            try: () =>
              respond({
                replace_original: true,
                text: "Starting review mode...",
                blocks: [section(":mag: *Starting Review Mode*\nVerifying completed work...")],
              }),
            catch: (error) =>
              new SlackResponseError({
                message: `Failed to update Slack message: ${String(error)}`,
                cause: error,
              }),
          });
        }

        // Start review session via worker
        const session = store.get(threadTs);
        const result = yield* workerProxy.startInterview(
          `${threadTs}-review`,
          channel,
          userId,
          "Review the completed work against acceptance criteria.",
          async (event) => {
            // Forward events through existing handler
            const pending = store.get(threadTs);
            if (pending) {
              store.touch(threadTs);
            }
          },
          session?.initialDescription ? extractProjectName(session.initialDescription) : undefined,
          "review",
          urls,
        ).pipe(
          Effect.catchTag("WorkerProxyError", (error) =>
            Effect.gen(function* () {
              console.error(`[ActionHandler] Failed to start review mode:`, error.message);
              yield* slackService.postMessage({
                channel,
                text: `<@${userId}> Failed to start review mode: ${error.message}`,
                blocks: formatErrorMessage(error.message, userId),
              });
              return undefined;
            }),
          ),
        );

        if (result && "workerId" in result) {
          store.setWorkerId(threadTs, result.workerId);
        }
      }),
      "start_review_mode",
    );
  });

  // Handle "Done for Now" / "Done" button click to close session
  app.action("session_done", async ({ body, ack, respond }) => {
    await ack();

    const action = (body as BlockAction).actions[0] as ButtonAction;
    const threadTs = action.value;
    const userId = body.user.id;
    const channel = (body as BlockAction).channel?.id;

    if (!threadTs || !channel) {
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
            text: "Only the interview initiator can close this session.",
            threadTs,
            blocks: formatNonInitiatorNotice(session.initiatorId),
          })
        );
      }
      return;
    }

    console.log(`[ActionHandler] Closing session ${threadTs}`);

    // Update the message
    if (respond) {
      await respond({
        replace_original: true,
        text: "Session complete.",
        blocks: [section(":white_check_mark: *Session Complete*\nThanks for using Clive!")],
      });
    }

    // Close the session
    store.close(threadTs);
  });
}
