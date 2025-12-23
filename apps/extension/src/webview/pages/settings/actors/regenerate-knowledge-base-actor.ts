import { fromCallback } from "xstate";
import { subscriptionHandlers, generateId } from "../../../rpc/hooks.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import type { KnowledgeBaseEvent } from "../machines/knowledge-base-machine.js";

export interface RegenerateActorInput {
  vscode: VSCodeAPI;
  onPhaseComplete?: () => void;
}

/**
 * XState actor that manages the regenerateKnowledgeBase RPC subscription
 * Uses fromCallback to create an actor that:
 * 1. Starts the subscription when invoked
 * 2. Sends events back to the parent machine on subscription updates
 * 3. Cleans up the subscription when stopped
 */
export const createRegenerateKnowledgeBaseActor = fromCallback<
  { type: "CANCEL" },
  RegenerateActorInput
>(({ sendBack, input }) => {
  const { vscode } = input;

  // Generate subscription ID
  const subscriptionId = generateId();

  // Register subscription handlers that send events back to the machine
  subscriptionHandlers.set(subscriptionId, {
    onData: (data: unknown) => {
      // Parse and send events back to parent machine
      const event = data as {
        type: string;
        message?: string;
        phaseId?: number;
        phaseName?: string;
        category?: string;
        entryCount?: number;
        totalEntries?: number;
      };

      if (event.type === "progress") {
        sendBack({
          type: "PROGRESS",
          message: event.message || "",
        } as KnowledgeBaseEvent);
      } else if (event.type === "phase_started") {
        sendBack({
          type: "PHASE_STARTED",
          phaseId: event.phaseId || 0,
          phaseName: event.phaseName || "",
        } as KnowledgeBaseEvent);
      } else if (event.type === "category_complete") {
        sendBack({
          type: "CATEGORY_COMPLETE",
          category: event.category || "",
          entryCount: event.entryCount || 0,
        } as KnowledgeBaseEvent);
      } else if (event.type === "phase_complete") {
        sendBack({
          type: "PHASE_COMPLETE",
          phaseId: event.phaseId || 0,
          totalEntries: event.totalEntries || 0,
        } as KnowledgeBaseEvent);
        // Invalidate query to refresh status
        input.onPhaseComplete?.();
      }
    },
    onComplete: () =>
      sendBack({ type: "SUBSCRIPTION_COMPLETE" } as KnowledgeBaseEvent),
    onError: (error: Error) =>
      sendBack({
        type: "SUBSCRIPTION_ERROR",
        error: error.message,
      } as KnowledgeBaseEvent),
  });

  // Start the subscription
  vscode.postMessage({
    id: subscriptionId,
    type: "subscription",
    path: ["knowledgeBase", "regenerateWithProgress"],
    input: { resume: false },
  });

  // Cleanup function called when actor stops
  return () => {
    subscriptionHandlers.delete(subscriptionId);
    vscode.postMessage({
      id: subscriptionId,
      type: "subscription",
      path: ["knowledgeBase", "regenerateWithProgress"],
      input: { _unsubscribe: true },
    });
  };
});

/**
 * XState actor that manages the resumeKnowledgeBase RPC subscription
 * Uses fromCallback to create an actor that:
 * 1. Starts the subscription when invoked
 * 2. Sends events back to the parent machine on subscription updates
 * 3. Cleans up the subscription when stopped
 */
export const createResumeKnowledgeBaseActor = fromCallback<
  { type: "CANCEL" },
  RegenerateActorInput
>(({ sendBack, input }) => {
  const { vscode } = input;

  // Generate subscription ID
  const subscriptionId = generateId();

  // Register subscription handlers that send events back to the machine
  subscriptionHandlers.set(subscriptionId, {
    onData: (data: unknown) => {
      // Parse and send events back to parent machine
      const event = data as {
        type: string;
        message?: string;
        phaseId?: number;
        phaseName?: string;
        category?: string;
        entryCount?: number;
        totalEntries?: number;
      };

      if (event.type === "progress") {
        sendBack({
          type: "PROGRESS",
          message: event.message || "",
        } as KnowledgeBaseEvent);
      } else if (event.type === "phase_started") {
        sendBack({
          type: "PHASE_STARTED",
          phaseId: event.phaseId || 0,
          phaseName: event.phaseName || "",
        } as KnowledgeBaseEvent);
      } else if (event.type === "category_complete") {
        sendBack({
          type: "CATEGORY_COMPLETE",
          category: event.category || "",
          entryCount: event.entryCount || 0,
        } as KnowledgeBaseEvent);
      } else if (event.type === "phase_complete") {
        sendBack({
          type: "PHASE_COMPLETE",
          phaseId: event.phaseId || 0,
          totalEntries: event.totalEntries || 0,
        } as KnowledgeBaseEvent);
        // Invalidate query to refresh status
        input.onPhaseComplete?.();
      }
    },
    onComplete: () =>
      sendBack({ type: "SUBSCRIPTION_COMPLETE" } as KnowledgeBaseEvent),
    onError: (error: Error) =>
      sendBack({
        type: "SUBSCRIPTION_ERROR",
        error: error.message,
      } as KnowledgeBaseEvent),
  });

  // Start the subscription with resume: true
  vscode.postMessage({
    id: subscriptionId,
    type: "subscription",
    path: ["knowledgeBase", "regenerateWithProgress"],
    input: { resume: true },
  });

  // Cleanup function called when actor stops
  return () => {
    subscriptionHandlers.delete(subscriptionId);
    vscode.postMessage({
      id: subscriptionId,
      type: "subscription",
      path: ["knowledgeBase", "regenerateWithProgress"],
      input: { _unsubscribe: true },
    });
  };
});
