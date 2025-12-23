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
  const id = `${input.sourceFile}-${input.targetTestPath}-${Date.now()}`;

  const e2eInfo = [];
  if (input.navigationPath) {
    e2eInfo.push(`navigation: ${input.navigationPath}`);
  }
  if (input.pageContext) {
    e2eInfo.push(`page: ${input.pageContext}`);
  }
  if (input.prerequisites && input.prerequisites.length > 0) {
    e2eInfo.push(`prerequisites: ${input.prerequisites.join(", ")}`);
  }
  if (input.relatedTests && input.relatedTests.length > 0) {
    e2eInfo.push(`related tests: ${input.relatedTests.length} found`);
  }
  if (input.userFlow) {
    e2eInfo.push(`user flow: ${input.userFlow}`);
  }
  if (input.testCases && input.testCases.length > 0) {
    e2eInfo.push(`${input.testCases.length} test case(s)`);
  }

  const e2eDetails = e2eInfo.length > 0 ? ` (E2E: ${e2eInfo.join("; ")})` : "";

  return {
    success: true,
    id,
    message: `Proposed ${input.isUpdate ? "update" : "creation"} of test file: ${input.targetTestPath} for ${input.sourceFile}${e2eDetails}`,
  };
}
