import type { ToolSet } from "ai";
import type { ProposeTestInput, ProposeTestOutput } from "./types.js";

/**
 * Approval constants shared between frontend and backend
 * These strings are used to communicate approval state
 */
export const APPROVAL = {
  YES: "Yes, confirmed.",
  NO: "No, denied.",
} as const;

/**
 * Get list of tool names that require human confirmation
 * Tools without an execute function require approval
 */
export function getToolsRequiringConfirmation<T extends ToolSet>(
  tools: T,
): string[] {
  return (Object.keys(tools) as (keyof T)[]).filter((key) => {
    const maybeTool = tools[key];
    return (
      typeof maybeTool === "object" &&
      maybeTool !== null &&
      "execute" in maybeTool &&
      typeof maybeTool.execute !== "function"
    );
  }) as string[];
}

/**
 * Process tool approval for proposeTest tool
 * When user approves, we generate the test ID and return success
 * When user denies, we return a rejection message
 */
export function processProposeTestApproval(
  input: ProposeTestInput,
  approved: boolean,
): ProposeTestOutput {
  if (!approved) {
    return {
      success: false,
      id: "",
      message: "User denied test proposal.",
    };
  }

  // Generate a unique ID for this proposal
  const id = `${input.sourceFile}-${Date.now()}`;
  const strategyCount = input.testStrategies.length;
  const testTypes = [
    ...new Set(input.testStrategies.map((s) => s.testType)),
  ].join(", ");

  return {
    success: true,
    id,
    message: `Proposed ${strategyCount} test strategies (${testTypes}) for ${input.sourceFile}`,
  };
}
