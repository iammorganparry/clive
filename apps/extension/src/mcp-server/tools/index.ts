/**
 * MCP Tool Registration
 * Registers all custom tools with the MCP server
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApprovePlan } from "./approve-plan.js";
import { registerCompleteTask } from "./complete-task.js";
import {
  registerProposePlan,
  registerProposeTestPlan,
} from "./propose-plan.js";
import { registerSearchKnowledge } from "./search-knowledge.js";
import { registerSummarizeContext } from "./summarize-context.js";

/**
 * Register all tools with the MCP server
 */
export function registerTools(server: McpServer): void {
  // Standalone tools (no bridge required)
  registerSearchKnowledge(server);
  registerCompleteTask(server);

  // Bridge-dependent tools (require VSCode extension)
  registerProposePlan(server); // New user story-based planning
  registerProposeTestPlan(server); // Deprecated - backward compatibility
  registerApprovePlan(server);
  registerSummarizeContext(server);
}

export {
  registerSearchKnowledge,
  registerCompleteTask,
  registerProposePlan,
  registerProposeTestPlan, // Deprecated
  registerApprovePlan,
  registerSummarizeContext,
};
