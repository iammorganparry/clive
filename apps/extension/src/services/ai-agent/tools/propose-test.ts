import { tool } from "ai";
import { z } from "zod";
import type { ProposeTestInput } from "../types.js";
import { processProposeTestApproval } from "../hitl-utils.js";

/**
 * Factory function to create proposeTestTool with optional approval callback
 * When no approval callback is provided, proposals are auto-approved
 */
export const createProposeTestTool = (
  waitForApproval?: (
    toolCallId: string,
    input: ProposeTestInput,
  ) => Promise<boolean>,
  approvalRegistry?: Set<string>,
) =>
  tool({
    description:
      "Propose a comprehensive testing strategy for a file. This can include unit, integration, and E2E test strategies.",
    inputSchema: z.object({
      sourceFile: z
        .string()
        .describe("The source file path to create tests for"),
      testStrategies: z
        .array(
          z.object({
            testType: z
              .enum(["unit", "integration", "e2e"])
              .describe("The type of test: 'unit', 'integration', or 'e2e'"),
            framework: z
              .string()
              .describe(
                "The testing framework to use (e.g., 'vitest', 'jest', 'playwright', 'cypress')",
              ),
            targetTestPath: z
              .string()
              .default("")
              .describe(
                "The proposed target path for this test file (relative to workspace root)",
              ),
            description: z
              .string()
              .default("")
              .describe("Description of what this test strategy covers"),
            isUpdate: z
              .boolean()
              .default(false)
              .describe("Whether this will update an existing test file"),
            // E2E-specific fields
            navigationPath: z
              .string()
              .optional()
              .describe("REQUIRED for E2E: The URL/route to navigate to"),
            pageContext: z
              .string()
              .optional()
              .describe(
                "REQUIRED for E2E: The page component containing this feature",
              ),
            prerequisites: z
              .array(z.string())
              .optional()
              .default([])
              .describe("Setup requirements for this test strategy"),
            userFlow: z
              .string()
              .optional()
              .describe("REQUIRED for E2E: Complete user journey description"),
            // Unit/Integration specific
            mockDependencies: z
              .array(z.string())
              .optional()
              .default([])
              .describe("Dependencies to mock for unit/integration tests"),
            testSetup: z
              .array(z.string())
              .optional()
              .default([])
              .describe("Setup steps for unit/integration tests"),
            testCases: z
              .array(
                z.object({
                  name: z.string().describe("Test case name"),
                  testType: z
                    .enum(["unit", "integration", "e2e"])
                    .describe("Test type"),
                  framework: z
                    .string()
                    .optional()
                    .describe("Testing framework"),
                  userActions: z
                    .array(z.string())
                    .default([])
                    .describe("Step-by-step actions"),
                  assertions: z
                    .array(z.string())
                    .default([])
                    .describe("Expected outcomes"),
                  category: z
                    .enum(["happy_path", "error", "edge_case", "accessibility"])
                    .describe("Test category"),
                }),
              )
              .default([])
              .describe("Test cases for this strategy"),
          }),
        )
        .describe(
          "Multiple test strategies for this file (unit, integration, E2E)",
        ),
      relatedTests: z
        .array(z.string())
        .optional()
        .describe("Paths to existing test files that may be impacted"),
    }),
    execute: async (input) => {
      // If no approval callback, auto-approve (for backward compatibility)
      if (!waitForApproval) {
        const result = processProposeTestApproval(input, true);
        // Register approved ID in registry if auto-approved
        if (approvalRegistry && result.success) {
          approvalRegistry.add(result.id);
        }
        return result;
      }

      // Generate tool call ID
      const toolCallId = `propose-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Wait for approval
      const approved = await waitForApproval(toolCallId, input);

      // Process approval and return result
      const result = processProposeTestApproval(input, approved);

      // Register approved ID in registry if approved
      if (approved && approvalRegistry && result.success) {
        approvalRegistry.add(result.id);
      }

      return result;
    },
  });

/**
 * Default proposeTestTool without approval callback (auto-approves)
 * Use createProposeTestTool with waitForApproval for manual approval flow
 */
export const proposeTestTool = createProposeTestTool();
