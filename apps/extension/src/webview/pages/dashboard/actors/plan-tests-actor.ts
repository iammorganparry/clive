import { fromCallback } from "xstate";
import type { VSCodeAPI } from "../../../services/vscode.js";
import { subscriptionHandlers, generateId } from "../../../rpc/hooks.js";
import {
  isProposalEvent,
  isProgressEvent,
  isPlanFileCreatedEvent,
  isContentStreamedEvent,
  isSubscriptionComplete,
} from "../schemas/rpc-events.js";
import type { FileTestEvent } from "../machines/file-test-machine.js";

export interface PlanTestsActorInput {
  filePath: string;
  vscode: VSCodeAPI;
}

export interface PlanTestsActorEvents {
  type: "CANCEL";
}

/**
 * XState actor that manages the planTests RPC subscription
 * Uses fromCallback to create an actor that:
 * 1. Starts the subscription when invoked
 * 2. Sends events back to the parent machine on subscription updates
 * 3. Cleans up the subscription when stopped
 */
export const createPlanTestsActor = fromCallback<
  PlanTestsActorEvents,
  PlanTestsActorInput
>(({ sendBack, receive, input }) => {
  const { filePath, vscode } = input;

  // Generate subscription ID
  const subscriptionId = generateId();

  // Register subscription handlers that send events back to the machine
  subscriptionHandlers.set(subscriptionId, {
    onData: (data: unknown) => {
      // Parse and send events back to parent machine
      if (isProposalEvent(data)) {
        sendBack({
          type: "PROPOSAL_RECEIVED",
          proposal: data.test,
          toolCallId: data.toolCallId,
          subscriptionId: subscriptionId,
        } as FileTestEvent);
      } else if (isProgressEvent(data)) {
        sendBack({
          type: "PROGRESS",
          message: data.message,
        } as FileTestEvent);
      } else if (isPlanFileCreatedEvent(data)) {
        sendBack({
          type: "PLAN_FILE_CREATED",
          planFilePath: data.planFilePath,
          proposalId: data.proposalId,
          subscriptionId: data.subscriptionId,
        } as FileTestEvent);
      } else if (isContentStreamedEvent(data)) {
        sendBack({
          type: "CONTENT_STREAMED",
          content: data.content,
        } as FileTestEvent);
      }
    },
    onComplete: (data: unknown) => {
      if (isSubscriptionComplete(data)) {
        // Send execution complete events for any immediate executions
        if (data.executions) {
          for (const exec of data.executions) {
            if (exec.filePath) {
              sendBack({
                type: "EXECUTION_COMPLETE",
                testId: exec.testId,
                filePath: exec.filePath,
              } as FileTestEvent);
            }
          }
        }

        sendBack({
          type: "SUBSCRIPTION_COMPLETE",
          executions: data.executions,
        } as FileTestEvent);
      }
    },
    onError: (error: Error) => {
      sendBack({
        type: "SUBSCRIPTION_ERROR",
        error: error.message,
      } as FileTestEvent);
    },
  });

  // Start subscription by posting message to VS Code
  vscode.postMessage({
    id: subscriptionId,
    type: "subscription",
    path: ["agents", "planTests"],
    input: { files: [filePath] },
  });

  // Handle incoming events (e.g., CANCEL from parent machine)
  receive((event) => {
    if (event.type === "CANCEL") {
      // Cleanup will happen in the return function
      // The parent machine will stop this actor, triggering cleanup
    }
  });

  // Cleanup function - called when actor stops (e.g., on CANCEL or state exit)
  return () => {
    subscriptionHandlers.delete(subscriptionId);
    vscode.postMessage({
      id: subscriptionId,
      type: "subscription",
      path: ["agents", "planTests"],
      input: { _unsubscribe: true },
    });
  };
});
