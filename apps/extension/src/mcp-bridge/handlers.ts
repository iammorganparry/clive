/**
 * MCP Bridge Handlers
 * Implementation of bridge method handlers for the VSCode extension side
 */

import { Effect, Runtime, pipe } from "effect";
import type {
  ApprovePlanBridgeResponse,
  ProposeTestPlanBridgeResponse,
  SummarizeContextBridgeResponse,
  TypedBridgeHandlers,
} from "./types.js";
import {
  initializePlanStreamingWriteEffect,
  appendPlanStreamingContentEffect,
  finalizePlanStreamingWriteEffect,
} from "../services/ai-agent/tools/propose-test-plan.js";
import { VSCodeService } from "../services/vs-code.js";
import type { CliveViewProvider } from "../views/clive-view-provider.js";
import { buildFullPlanContent } from "../utils/frontmatter-utils.js";

/**
 * Create bridge handlers for the extension
 * These handlers respond to calls from the MCP server
 *
 * @param webviewProvider - Optional webview provider for emitting events to the frontend
 */
export function createBridgeHandlers(
  webviewProvider?: CliveViewProvider | null,
): TypedBridgeHandlers {
  const runtime = Runtime.defaultRuntime;

  return {
    /**
     * Handle proposeTestPlan requests
     * Streams the plan content to a file in the VSCode editor
     */
    proposeTestPlan: async (
      params: unknown,
    ): Promise<ProposeTestPlanBridgeResponse> => {
      const input = params as {
        name: string;
        overview?: string;
        suites?: Array<{
          id: string;
          name: string;
          testType: "unit" | "integration" | "e2e";
          targetFilePath: string;
          sourceFiles: string[];
          description?: string;
        }>;
        mockDependencies?: Array<{
          dependency: string;
          existingMock?: string;
          mockStrategy: "factory" | "inline" | "spy";
        }>;
        discoveredPatterns?: {
          testFramework: string;
          mockFactoryPaths: string[];
          testPatterns: string[];
        };
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

        // Build full content with YAML frontmatter using shared utility
        const fullContent = buildFullPlanContent(
          {
            name: input.name,
            overview: input.overview,
            suites: input.suites,
          },
          input.planContent,
        );

        // Initialize the streaming write
        await pipe(
          initializePlanStreamingWriteEffect(filePath, input.toolCallId),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        // Write the plan content with YAML frontmatter
        await pipe(
          appendPlanStreamingContentEffect(input.toolCallId, fullContent),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        // Finalize the write
        const finalPath = await pipe(
          finalizePlanStreamingWriteEffect(input.toolCallId),
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(runtime),
        );

        // Emit plan content event to webview so UI can display approval card
        const webview = webviewProvider?.getWebview();
        if (webview) {
          webview.webview.postMessage({
            type: "mcp-bridge-event",
            event: "plan-content-streaming",
            data: {
              toolCallId: input.toolCallId,
              content: fullContent,
              isComplete: true,
              filePath: finalPath,
            },
          });
        }

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
     * Switches the agent mode from plan to act by emitting an event to the webview
     */
    approvePlan: async (params: unknown): Promise<ApprovePlanBridgeResponse> => {
      const input = params as {
        approved: boolean;
        planId?: string;
        feedback?: string;
      };

      // Emit event to webview for state machine integration
      const webview = webviewProvider?.getWebview();
      if (webview) {
        webview.webview.postMessage({
          type: "mcp-bridge-event",
          event: "plan-approval",
          data: {
            approved: input.approved,
            planId: input.planId,
            feedback: input.feedback,
          },
        });
      }

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
     * Manages the AI message history by emitting an event to the webview
     */
    summarizeContext: async (
      params: unknown,
    ): Promise<SummarizeContextBridgeResponse> => {
      const input = params as {
        summary: string;
        tokensBefore?: number;
        tokensAfter?: number;
        preserveKnowledge?: boolean;
      };

      const tokensBefore = input.tokensBefore || 10000;
      const tokensAfter = input.tokensAfter || 2000;

      // Emit event to webview for context management
      const webview = webviewProvider?.getWebview();
      if (webview) {
        webview.webview.postMessage({
          type: "mcp-bridge-event",
          event: "summarize-context",
          data: {
            summary: input.summary,
            tokensBefore,
            tokensAfter,
            preserveKnowledge: input.preserveKnowledge ?? true,
          },
        });
      }

      return {
        success: true,
        tokensBefore,
        tokensAfter,
        message: `Context summarized. Reduced from ~${tokensBefore} to ~${tokensAfter} tokens.`,
      };
    },
  };
}
