/**
 * summarizeContext MCP Tool
 * Manages AI message history and context summarization
 * Requires extension bridge for message history manipulation
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ensureBridgeConnected } from "../bridge/extension-bridge.js";

/**
 * Input schema for summarizeContext
 */
const SummarizeContextInputSchema = z.object({
  summary: z
    .string()
    .describe(
      "A comprehensive summary of the conversation context so far. Include: key decisions made, files modified, tests written, current task progress, and any important context for continuing the task.",
    ),
  tokensBefore: z
    .number()
    .optional()
    .describe("Estimated tokens in context before summarization"),
  tokensAfter: z
    .number()
    .optional()
    .describe("Estimated tokens after summarization"),
  preserveKnowledge: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Whether to preserve knowledge base entries in the summarized context",
    ),
});

/**
 * Register the summarizeContext tool with the MCP server
 */
export function registerSummarizeContext(server: McpServer): void {
  server.tool(
    "summarizeContext",
    "Summarize the current conversation context to reduce token usage. Use this when the context is getting large and you need to continue working. The summary will replace the earlier message history while preserving essential information.",
    SummarizeContextInputSchema.shape,
    async (input: z.infer<typeof SummarizeContextInputSchema>) => {
      try {
        const bridge = await ensureBridgeConnected();

        // Call the extension to handle context summarization
        const result = await bridge.call<{
          success: boolean;
          tokensBefore: number;
          tokensAfter: number;
          message: string;
        }>("summarizeContext", input);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                tokensBefore: result.tokensBefore,
                tokensAfter: result.tokensAfter,
                tokensSaved: result.tokensBefore - result.tokensAfter,
                message: result.message,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to summarize context",
              }),
            },
          ],
        };
      }
    },
  );
}
