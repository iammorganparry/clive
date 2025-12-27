import { tool } from "ai";
import { z } from "zod";

/**
 * Input schema for proposeTestPlan tool
 * Enforces YAML frontmatter structure for plan output
 */
const ProposeTestPlanInputSchema = z.object({
  name: z
    .string()
    .describe("Plan name (e.g., 'Test Plan for Authentication')"),
  overview: z
    .string()
    .describe("Brief description of what tests will cover (1-2 sentences)"),
  todos: z
    .array(z.string())
    .describe("List of test types to be created (e.g., ['unit-tests', 'integration-tests', 'e2e-tests'])"),
  planContent: z
    .string()
    .describe(
      "The complete test plan in markdown format with YAML frontmatter. Must include:\n" +
        "- YAML frontmatter with name, overview, todos\n" +
        "- Problem Summary section\n" +
        "- Implementation Plan with numbered sections\n" +
        "- Changes Summary footer",
    ),
});

export type ProposeTestPlanInput = z.infer<typeof ProposeTestPlanInputSchema>;

export interface ProposeTestPlanOutput {
  success: boolean;
  planId: string;
  name: string;
  overview: string;
  todos: string[];
  message: string;
}

/**
 * Factory function to create proposeTestPlanTool with optional approval callback
 * When no approval callback is provided, proposals are auto-approved
 */
export const createProposeTestPlanTool = (
  waitForApproval?: (
    toolCallId: string,
    input: ProposeTestPlanInput,
  ) => Promise<boolean>,
  approvalRegistry?: Set<string>,
) =>
  tool({
    description:
      "Output a structured test plan proposal in markdown format with YAML frontmatter. " +
      "This tool should be used in PLAN MODE to present a comprehensive test strategy " +
      "for user review before writing any test files. The plan must follow the structured " +
      "format defined in the system prompt with YAML frontmatter, Problem Summary, " +
      "Implementation Plan sections, and Changes Summary.",
    inputSchema: ProposeTestPlanInputSchema,
    execute: async (input): Promise<ProposeTestPlanOutput> => {
      // Generate plan ID
      const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // If no approval callback, auto-approve (for backward compatibility)
      if (!waitForApproval) {
        const result: ProposeTestPlanOutput = {
          success: true,
          planId,
          name: input.name,
          overview: input.overview,
          todos: input.todos,
          message: `Test plan proposal created: ${input.name}`,
        };
        // Register approved ID in registry if auto-approved
        if (approvalRegistry) {
          approvalRegistry.add(planId);
        }
        return result;
      }

      // Generate tool call ID
      const toolCallId = `propose-plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Wait for approval
      const approved = await waitForApproval(toolCallId, input);

      const result: ProposeTestPlanOutput = {
        success: approved,
        planId,
        name: input.name,
        overview: input.overview,
        todos: input.todos,
        message: approved
          ? `Test plan proposal approved: ${input.name}`
          : `Test plan proposal rejected: ${input.name}`,
      };

      // Register approved ID in registry if approved
      if (approved && approvalRegistry) {
        approvalRegistry.add(planId);
      }

      return result;
    },
  });

/**
 * Default proposeTestPlanTool without approval callback (auto-approves)
 * Use createProposeTestPlanTool with waitForApproval for manual approval flow
 */
export const proposeTestPlanTool = createProposeTestPlanTool();

