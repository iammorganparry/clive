/**
 * Tool Name Resolution
 * Provides correct tool names based on AI provider
 *
 * When using Claude CLI, tools are registered via MCP with namespaced names:
 * - mcp__clive-tools__proposeTestPlan
 * - mcp__clive-tools__searchKnowledge
 * - etc.
 *
 * When using AI SDK (Anthropic provider), tools are registered directly:
 * - proposeTestPlan
 * - searchKnowledge
 * - etc.
 */

import type { BuildConfig } from "./types.js";

/**
 * Get the correct tool name based on AI provider
 * For Claude CLI, returns MCP-namespaced name (mcp__clive-tools__<name>)
 * For AI SDK, returns the plain tool name
 */
export const getToolName = (baseName: string, config: BuildConfig): string => {
  if (config.aiProvider === "claude-cli") {
    return `mcp__clive-tools__${baseName}`;
  }
  return baseName;
};

/**
 * Common tool name constants
 * Use these with getToolName() for consistent naming
 */
export const ToolNames = {
  proposeTestPlan: "proposeTestPlan",
  searchKnowledge: "searchKnowledge",
  completeTask: "completeTask",
  approvePlan: "approvePlan",
  summarizeContext: "summarizeContext",
} as const;

export type ToolName = (typeof ToolNames)[keyof typeof ToolNames];
