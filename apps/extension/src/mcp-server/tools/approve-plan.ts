/**
 * approvePlan MCP Tool
 * Handles plan approval/rejection and mode switching
 * Requires extension bridge for mode state management
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBridgeConnected } from "../bridge/extension-bridge.js";

/**
 * Input schema for approvePlan
 */
const ApprovePlanInputSchema = z.object({
  approved: z
    .boolean()
    .describe("Whether the plan was approved (true) or rejected (false)"),
  planId: z.string().optional().describe("The ID of the plan being approved"),
  feedback: z
    .string()
    .optional()
    .describe("Optional feedback if the plan was rejected"),
});

/**
 * Register the approvePlan tool with the MCP server
 */
export function registerApprovePlan(server: McpServer): void {
  server.tool(
    "approvePlan",
    "Handle plan approval or rejection. When approved, the agent transitions from PLAN MODE to ACT MODE and can begin writing test files. When rejected, the agent should revise the plan based on feedback.",
    ApprovePlanInputSchema.shape,
    async (input: z.infer<typeof ApprovePlanInputSchema>) => {
      try {
        const bridge = await ensureBridgeConnected();

        // Call the extension to handle mode switching
        const result = await bridge.call<{
          success: boolean;
          mode: "plan" | "act";
          message: string;
        }>("approvePlan", input);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                approved: input.approved,
                mode: result.mode,
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
                approved: false,
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to process plan approval",
              }),
            },
          ],
        };
      }
    },
  );
}
