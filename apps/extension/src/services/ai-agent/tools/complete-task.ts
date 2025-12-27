import { tool } from "ai";
import { Effect, Runtime } from "effect";
import { z } from "zod";

/**
 * Input schema for completeTask tool
 * Requires validation that all tests have passed
 */
const CompleteTaskInputSchema = z.object({
  summary: z
    .string()
    .describe(
      "Brief summary of what was accomplished (e.g., 'All 5 test files written and verified passing')",
    ),
  testsWritten: z
    .number()
    .describe("Number of test files that were written"),
  testsPassed: z
    .number()
    .describe("Number of test files that passed verification"),
  confirmation: z
    .boolean()
    .describe(
      "Must be true - confirms that you have verified all tests pass before completing",
    ),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskInputSchema>;

export interface CompleteTaskOutput {
  success: boolean;
  message: string;
  completed: boolean;
}


/**
 * Validate completion input using Effect
 */
function validateCompletion(
  input: CompleteTaskInput,
): Effect.Effect<CompleteTaskOutput> {
  return Effect.gen(function* () {
    // Validate that confirmation is true
    if (!input.confirmation) {
      return yield* Effect.succeed({
        success: false,
        message:
          "Cannot complete task without confirmation that all tests pass. Set confirmation=true.",
        completed: false,
      });
    }

    // Validate that tests written matches tests passed
    if (input.testsWritten !== input.testsPassed) {
      return yield* Effect.succeed({
        success: false,
        message: `Cannot complete task: ${input.testsWritten} tests written but only ${input.testsPassed} passed. All tests must pass before completion.`,
        completed: false,
      });
    }

    // Validate that at least one test was written
    if (input.testsWritten === 0) {
      return yield* Effect.succeed({
        success: false,
        message:
          "Cannot complete task: No tests were written. Complete the task by writing at least one test file.",
        completed: false,
      });
    }

    return yield* Effect.succeed({
      success: true,
      message: `Task completed successfully: ${input.summary}`,
      completed: true,
    });
  });
}

/**
 * Factory function to create completeTaskTool
 * Validates that all tests have passed before allowing completion
 */
export const createCompleteTaskTool = () =>
  tool({
    description:
      "Signal that the testing task is complete. This tool CANNOT be used until you've " +
      "confirmed from test execution results that ALL tests have passed. " +
      "Before using this tool, you must ask yourself in <thinking></thinking> tags " +
      "if you've verified that all test files pass. " +
      "This tool replaces the [COMPLETE] delimiter with structured validation.",
    inputSchema: CompleteTaskInputSchema,
    execute: async (input): Promise<CompleteTaskOutput> => {
      return Runtime.runPromise(Runtime.defaultRuntime)(
        validateCompletion(input).pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              success: false,
              message: "Unexpected error during validation",
              completed: false,
            }),
          ),
        ),
      );
    },
  });

/**
 * Default completeTaskTool
 */
export const completeTaskTool = createCompleteTaskTool();

