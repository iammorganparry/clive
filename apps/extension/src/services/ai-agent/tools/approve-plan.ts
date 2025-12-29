import { tool } from "ai";
import { Effect, Runtime } from "effect";
import { z } from "zod";

/**
 * Input schema for approvePlan tool
 * Allows agent to approve a test plan and switch to act mode
 */
const ApprovePlanInputSchema = z.object({
  planId: z
    .string()
    .describe("ID of the plan being approved (e.g., 'test-plan-1234')"),
  suites: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "Unique identifier for the suite (e.g., 'suite-1-unit-auth')",
          ),
        name: z
          .string()
          .describe(
            "Human-readable name (e.g., 'Unit Tests for Authentication Logic')",
          ),
        testType: z
          .enum(["unit", "integration", "e2e"])
          .describe("Type of test suite"),
        targetFilePath: z
          .string()
          .describe(
            "Path where test file will be created (e.g., 'src/auth/__tests__/auth.test.ts')",
          ),
        sourceFiles: z
          .array(z.string())
          .describe("Source files that will be tested by this suite"),
        description: z
          .string()
          .optional()
          .describe("Brief description of what this suite tests"),
      }),
    )
    .describe(
      "Array of test suites from the approved plan. Each suite will be processed individually in the queue.",
    ),
  userMessage: z
    .string()
    .optional()
    .describe("The user's approval message (e.g., 'looks good, proceed')"),
});

export type ApprovePlanInput = z.infer<typeof ApprovePlanInputSchema>;

export interface ApprovePlanOutput {
  success: boolean;
  message: string;
  planId: string;
  suiteCount: number;
  switchedToActMode: boolean;
}

/**
 * Create output result for approvePlan
 */
function createOutputResult(
  input: ApprovePlanInput,
  switchedToActMode: boolean,
): ApprovePlanOutput {
  return {
    success: true,
    message: `Plan approved. Switching to act mode to write ${input.suites.length} test suite${input.suites.length !== 1 ? "s" : ""}.`,
    planId: input.planId,
    suiteCount: input.suites.length,
    switchedToActMode,
  };
}

/**
 * Validate the plan approval input
 */
function validatePlanApproval(
  input: ApprovePlanInput,
): Effect.Effect<ApprovePlanOutput, Error> {
  return Effect.gen(function* () {
    // Validate that at least one suite is provided
    if (input.suites.length === 0) {
      return yield* Effect.fail(
        new Error(
          "Cannot approve plan: No test suites provided. Plan must include at least one test suite.",
        ),
      );
    }

    // Validate each suite has required fields
    for (const suite of input.suites) {
      if (!suite.id || !suite.name || !suite.targetFilePath) {
        return yield* Effect.fail(
          new Error(
            `Invalid suite: ${suite.name || "unnamed"}. All suites must have id, name, and targetFilePath.`,
          ),
        );
      }
    }

    return createOutputResult(input, true);
  });
}

/**
 * Factory function to create approvePlanTool
 * Allows agent to approve a test plan and trigger mode switch to act
 */
export const createApprovePlanTool = (
  progressCallback?: (status: string, message: string) => void,
) =>
  tool({
    description:
      "Approve the test plan and switch to act mode to begin writing tests. " +
      "Call this tool when the user indicates approval of the proposed test plan " +
      "(e.g., user says 'looks good', 'approved', 'proceed', 'write the tests'). " +
      "This tool will trigger a mode switch from plan mode to act mode, allowing you " +
      "to use writeTestFile and other write tools. You MUST provide the complete suites " +
      "array from the proposeTestPlan output you created earlier.",
    inputSchema: ApprovePlanInputSchema,
    execute: (input): Promise<ApprovePlanOutput> =>
      Runtime.runPromise(Runtime.defaultRuntime)(
        Effect.gen(function* () {
          // Validate the input
          const result = yield* validatePlanApproval(input);

          // Emit plan-approved event to frontend
          yield* Effect.sync(() => {
            progressCallback?.(
              "plan-approved",
              JSON.stringify({
                type: "plan-approved",
                planId: input.planId,
                suites: input.suites,
                userMessage: input.userMessage,
              }),
            );
          });

          return result;
        }).pipe(
          Effect.catchAll((error) =>
            Effect.succeed({
              success: false,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to approve plan",
              planId: input.planId,
              suiteCount: input.suites.length,
              switchedToActMode: false,
            }),
          ),
        ),
      ),
  });

/**
 * Default approvePlanTool without callback
 */
export const approvePlanTool = createApprovePlanTool();
