/**
 * completeTask MCP Tool
 * Signals that a testing task is complete with validation
 * This is a standalone tool that doesn't need the VSCode extension bridge
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Input schema for completeTask
 */
const CompleteTaskInputSchema = z.object({
  summary: z
    .string()
    .describe(
      "Brief summary of what was accomplished (e.g., 'All 5 test files written and verified passing')",
    ),
  testsWritten: z.number().describe("Number of test files that were written"),
  testsPassed: z
    .number()
    .describe("Number of test files that passed verification"),
  confirmation: z
    .boolean()
    .describe(
      "Must be true - confirms that you have verified all tests pass before completing",
    ),
});

/**
 * Output from completeTask
 */
interface CompleteTaskOutput {
  success: boolean;
  message: string;
  completed: boolean;
}

/**
 * Validate completion input
 */
function validateCompletion(
  input: z.infer<typeof CompleteTaskInputSchema>,
): CompleteTaskOutput {
  // Validate that confirmation is true
  if (!input.confirmation) {
    return {
      success: false,
      message:
        "Cannot complete task without confirmation that all tests pass. Set confirmation=true.",
      completed: false,
    };
  }

  // Validate that tests written matches tests passed
  if (input.testsWritten !== input.testsPassed) {
    return {
      success: false,
      message: `Cannot complete task: ${input.testsWritten} tests written but only ${input.testsPassed} passed. All tests must pass before completion.`,
      completed: false,
    };
  }

  // Validate that at least one test was written
  if (input.testsWritten === 0) {
    return {
      success: false,
      message:
        "Cannot complete task: No tests were written. Complete the task by writing at least one test file.",
      completed: false,
    };
  }

  return {
    success: true,
    message: `Task completed successfully: ${input.summary}`,
    completed: true,
  };
}

/**
 * Register the completeTask tool with the MCP server
 */
export function registerCompleteTask(server: McpServer): void {
  server.tool(
    "completeTask",
    "Signal that the testing task is complete. This tool CANNOT be used until you've confirmed from test execution results that ALL tests have passed. Before using this tool, verify that all test files pass. This tool replaces the [COMPLETE] delimiter with structured validation.",
    CompleteTaskInputSchema.shape,
    async (input: z.infer<typeof CompleteTaskInputSchema>) => {
      const result = validateCompletion(input);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
