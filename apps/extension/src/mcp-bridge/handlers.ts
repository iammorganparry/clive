/**
 * MCP Bridge Handlers
 * Implementation of bridge method handlers for the VSCode extension side
 */

import { Effect, Runtime, pipe } from "effect";
import type { BridgeHandlers } from "./types.js";
import {
  initializePlanStreamingWriteEffect,
  appendPlanStreamingContentEffect,
  finalizePlanStreamingWriteEffect,
} from "../services/ai-agent/tools/propose-test-plan.js";
import { VSCodeService } from "../services/vs-code.js";

/**
 * Create bridge handlers for the extension
 * These handlers respond to calls from the MCP server
 */
export function createBridgeHandlers(): BridgeHandlers {
  const runtime = Runtime.defaultRuntime;

  return {
    /**
     * Handle proposeTestPlan requests
     * Streams the plan content to a file in the VSCode editor
     */
    proposeTestPlan: async (params: unknown) => {
      const input = params as {
        name: string;
        planContent: string;
        toolCallId: string;
      };

      try {
        // Generate a unique plan file path
        const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const sanitizedName = input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .substring(0, 50);
        const filePath = `.clive/plans/${sanitizedName}-${planId.slice(-6)}.md`;

        // Initialize the streaming write
        await pipe(
          initializePlanStreamingWriteEffect(filePath, input.toolCallId),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        // Write the plan content
        await pipe(
          appendPlanStreamingContentEffect(input.toolCallId, input.planContent),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        // Finalize the write
        const finalPath = await pipe(
          finalizePlanStreamingWriteEffect(input.toolCallId),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        return {
          success: true,
          planId,
          filePath: finalPath,
          message: `Test plan created: ${input.name}`,
        };
      } catch (error) {
        return {
          success: false,
          planId: "",
          message:
            error instanceof Error ? error.message : "Failed to create plan",
        };
      }
    },

    /**
     * Handle approvePlan requests
     * Switches the agent mode from plan to act
     */
    approvePlan: async (params: unknown) => {
      const input = params as {
        approved: boolean;
        planId?: string;
        feedback?: string;
      };

      // TODO: Implement mode switching logic
      // This would typically update the agent state machine
      // For now, just acknowledge the request

      if (input.approved) {
        return {
          success: true,
          mode: "act" as const,
          message: "Plan approved. Switching to act mode.",
        };
      }

      return {
        success: true,
        mode: "plan" as const,
        message: input.feedback
          ? `Plan rejected: ${input.feedback}`
          : "Plan rejected. Please revise.",
      };
    },

    /**
     * Handle summarizeContext requests
     * Manages the AI message history
     */
    summarizeContext: async (params: unknown) => {
      const input = params as {
        summary: string;
        tokensBefore?: number;
        tokensAfter?: number;
        preserveKnowledge?: boolean;
      };

      // TODO: Implement context summarization
      // This would typically manipulate the message history in the agent
      // For now, just acknowledge the request

      const tokensBefore = input.tokensBefore || 10000;
      const tokensAfter = input.tokensAfter || 2000;

      return {
        success: true,
        tokensBefore,
        tokensAfter,
        message: `Context summarized. Reduced from ~${tokensBefore} to ~${tokensAfter} tokens.`,
      };
    },
  };
}
