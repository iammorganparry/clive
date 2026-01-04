/**
 * MCP Tool Registration
 * Registers all custom tools with the MCP server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchKnowledge } from "./search-knowledge.js";
import { registerCompleteTask } from "./complete-task.js";
import { registerProposeTestPlan } from "./propose-test-plan.js";
import { registerApprovePlan } from "./approve-plan.js";
import { registerSummarizeContext } from "./summarize-context.js";

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: McpServer): void {
  // Standalone tools (no bridge required)
  registerSearchKnowledge(server);
  registerCompleteTask(server);

  // Bridge-dependent tools (require VSCode extension)
  registerProposeTestPlan(server);
  registerApprovePlan(server);
  registerSummarizeContext(server);
}

export {
  registerSearchKnowledge,
  registerCompleteTask,
  registerProposeTestPlan,
  registerApprovePlan,
  registerSummarizeContext,
};
