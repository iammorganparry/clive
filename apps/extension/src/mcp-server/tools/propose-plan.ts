/**
 * proposePlan MCP Tool
 * Outputs a structured plan proposal with user stories, acceptance criteria, and Definition of Done
 * Requires extension bridge for VSCode editor streaming
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBridgeConnected } from "../bridge/extension-bridge.js";

/**
 * User Story schema
 */
const UserStorySchema = z.object({
  role: z.string().describe("Type of user (e.g., 'developer', 'user', 'admin')"),
  capability: z.string().describe("What they want to do"),
  benefit: z.string().describe("Why they want it / value delivered"),
});

/**
 * Task schema with user stories, acceptance criteria, and Definition of Done
 */
const TaskSchema = z.object({
  id: z.string().describe("Unique identifier (e.g., 'task-1')"),
  title: z.string().describe("User-facing capability (not implementation detail)"),

  userStory: UserStorySchema.optional().describe(
    "User story for this task (optional if covered by epic user story)"
  ),

  acceptanceCriteria: z
    .array(z.string())
    .describe("Testable, specific, measurable criteria for completion"),

  definitionOfDone: z
    .array(z.string())
    .describe("Checklist including tests, code review, documentation, build"),

  skill: z
    .enum(["feature", "bugfix", "refactor", "docs", "unit-tests", "e2e-tests"])
    .describe("Skill type - default to 'feature' for user-facing capabilities"),

  complexity: z
    .number()
    .min(1)
    .max(10)
    .describe("Complexity rating 1-10 with reasoning"),

  estimatedEffort: z
    .string()
    .optional()
    .describe("Optional effort estimate (e.g., '4-6 hours')"),

  dependencies: z
    .array(z.string())
    .optional()
    .describe("Other tasks, services, or utilities this depends on"),

  technicalNotes: z
    .string()
    .describe(
      "REQUIRED: Must include files affected, existing patterns (file:line), code examples, testing strategy, all based on codebase research"
    ),

  outOfScope: z
    .string()
    .optional()
    .describe("What this task explicitly does NOT include"),
});

/**
 * Risk schema
 */
const RiskSchema = z.object({
  description: z.string().describe("Risk description"),
  mitigation: z.string().describe("How to mitigate this risk"),
});

/**
 * New plan schema with user stories and acceptance criteria
 */
const ProposePlanInputSchema = z.object({
  name: z.string().describe("Epic name (user-facing value proposition)"),

  overview: z
    .string()
    .describe("Executive summary - brief business case (1-2 sentences)"),

  category: z
    .enum(["feature", "bugfix", "refactor", "docs"])
    .describe("Overall category of work"),

  epicUserStory: UserStorySchema.describe(
    "Primary user story driving this epic"
  ),

  scope: z
    .object({
      inScope: z.array(z.string()).describe("What we're delivering"),
      outOfScope: z.array(z.string()).describe("What we're NOT doing"),
    })
    .optional()
    .describe("Scope boundaries"),

  successCriteria: z
    .array(z.string())
    .optional()
    .describe("Measurable criteria for epic completion"),

  tasks: z.array(TaskSchema).describe("Tasks with user stories and acceptance criteria"),

  risks: z
    .array(RiskSchema)
    .optional()
    .describe("Identified risks and mitigations"),

  dependencies: z
    .array(z.string())
    .optional()
    .describe("External dependencies"),

  verificationPlan: z
    .array(z.string())
    .optional()
    .describe("Steps to verify epic completion"),

  planContent: z
    .string()
    .describe("The complete plan in markdown format with YAML frontmatter"),
});

/**
 * Legacy test plan schema for backward compatibility (DEPRECATED)
 */
const LegacyTestPlanSchema = z.object({
  name: z.string(),
  overview: z.string(),
  suites: z.array(z.any()),
  mockDependencies: z.array(z.any()).optional(),
  externalDependencies: z.array(z.any()).optional(),
  discoveredPatterns: z.any().optional(),
  regressionAnalysis: z.any().optional(),
  planContent: z.string(),
});

/**
 * Check if input is legacy test plan format
 */
function isLegacyTestPlan(input: any): boolean {
  return input.suites !== undefined;
}

/**
 * Convert legacy test plan to new format (basic conversion)
 */
function convertLegacyToNew(legacy: z.infer<typeof LegacyTestPlanSchema>) {
  console.warn(
    "[DEPRECATED] Legacy test plan format detected. Please update to new user story format."
  );

  // Basic conversion - wrap in a single task
  return {
    name: legacy.name,
    overview: legacy.overview,
    category: "feature" as const,
    epicUserStory: {
      role: "developer",
      capability: "have test coverage",
      benefit: "ensure code quality",
    },
    tasks: [
      {
        id: "task-1",
        title: "Add test coverage",
        acceptanceCriteria: legacy.suites.map(
          (suite: any) => `${suite.testType} tests for ${suite.name}`
        ),
        definitionOfDone: [
          "All test suites created",
          "Tests passing",
          "Code reviewed",
        ],
        skill: "unit-tests" as const,
        complexity: 5,
        technicalNotes: `Legacy test plan conversion. Original suites: ${JSON.stringify(legacy.suites, null, 2)}`,
      },
    ],
    planContent: legacy.planContent,
  };
}

/**
 * Register the proposePlan tool with the MCP server
 */
export function registerProposePlan(server: McpServer): void {
  server.tool(
    "proposePlan",
    "Output a structured plan proposal with user stories, acceptance criteria, and Definition of Done. This tool should be used in PLAN MODE to present a comprehensive plan for user review before implementation. Plans must be based on codebase research with specific file references, code examples, and pattern analysis.",
    ProposePlanInputSchema.shape,
    async (input: z.infer<typeof ProposePlanInputSchema> | z.infer<typeof LegacyTestPlanSchema>) => {
      try {
        const bridge = await ensureBridgeConnected();

        // Handle legacy format
        let planInput = input;
        if (isLegacyTestPlan(input)) {
          planInput = convertLegacyToNew(input as z.infer<typeof LegacyTestPlanSchema>);
        }

        // Validate against new schema
        const validatedInput = ProposePlanInputSchema.parse(planInput);

        // Generate a unique tool call ID
        const toolCallId = `propose-plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Call the extension to handle the plan streaming
        const result = await bridge.call<{
          success: boolean;
          planId: string;
          filePath?: string;
          message: string;
        }>("proposePlan", {
          ...validatedInput,
          toolCallId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                planId: result.planId,
                name: validatedInput.name,
                overview: validatedInput.overview,
                category: validatedInput.category,
                epicUserStory: validatedInput.epicUserStory,
                tasks: validatedInput.tasks,
                successCriteria: validatedInput.successCriteria,
                risks: validatedInput.risks,
                dependencies: validatedInput.dependencies,
                message: result.message,
                filePath: result.filePath,
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
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to propose plan",
              }),
            },
          ],
        };
      }
    },
  );
}

/**
 * Register deprecated proposeTestPlan alias for backward compatibility
 * @deprecated Use proposePlan instead
 */
export function registerProposeTestPlan(server: McpServer): void {
  console.warn(
    "[DEPRECATED] proposeTestPlan is deprecated. Use proposePlan instead."
  );

  server.tool(
    "proposeTestPlan",
    "[DEPRECATED] Use proposePlan instead. Output a structured test plan proposal in markdown format with YAML frontmatter.",
    LegacyTestPlanSchema.shape,
    async (input: z.infer<typeof LegacyTestPlanSchema>) => {
      try {
        const bridge = await ensureBridgeConnected();

        // Convert to new format
        const newInput = convertLegacyToNew(input);

        const toolCallId = `propose-plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        const result = await bridge.call<{
          success: boolean;
          planId: string;
          filePath?: string;
          message: string;
        }>("proposePlan", {
          ...newInput,
          toolCallId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                planId: result.planId,
                message: `${result.message}\n\n[DEPRECATED] This tool is deprecated. Please use 'proposePlan' with the new user story format.`,
                filePath: result.filePath,
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
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to propose test plan",
              }),
            },
          ],
        };
      }
    },
  );
}
