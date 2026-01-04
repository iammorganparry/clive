/**
 * proposeTestPlan MCP Tool
 * Outputs a structured test plan proposal
 * Requires extension bridge for VSCode editor streaming
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureBridgeConnected } from "../bridge/extension-bridge.js";

/**
 * Input schema for proposeTestPlan
 */
const ProposeTestPlanInputSchema = z.object({
  name: z.string().describe("Plan name (e.g., 'Test Plan for Authentication')"),
  overview: z
    .string()
    .describe("Brief description of what tests will cover (1-2 sentences)"),
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
    .describe("Array of test suites to be created"),
  mockDependencies: z
    .array(
      z.object({
        dependency: z
          .string()
          .describe("Name of the dependency to mock"),
        existingMock: z
          .string()
          .optional()
          .describe("Path to existing mock factory if found"),
        mockStrategy: z
          .enum(["factory", "inline", "spy"])
          .describe("How to mock the dependency"),
      }),
    )
    .describe("All mock dependencies identified during planning"),
  externalDependencies: z
    .array(
      z.object({
        type: z
          .enum(["database", "api", "filesystem", "network"])
          .describe("Type of external dependency"),
        name: z.string().describe("Name of the dependency"),
        testStrategy: z
          .string()
          .describe("How to handle in tests"),
      }),
    )
    .optional()
    .describe("External dependencies requiring special test setup"),
  discoveredPatterns: z
    .object({
      testFramework: z.string().describe("Detected test framework"),
      mockFactoryPaths: z
        .array(z.string())
        .describe("Paths to existing mock factories"),
      testPatterns: z
        .array(z.string())
        .describe("Key patterns found in similar tests"),
    })
    .describe("Patterns discovered during code analysis"),
  planContent: z
    .string()
    .describe(
      "The complete test plan in markdown format with YAML frontmatter",
    ),
  regressionAnalysis: z
    .object({
      relatedTestFiles: z.array(z.string()),
      testsRun: z.number(),
      passed: z.number(),
      failed: z.number(),
      skipped: z.number().optional(),
      failures: z.array(
        z.object({
          testFile: z.string(),
          testName: z.string(),
          errorMessage: z.string(),
          classification: z.enum(["expected", "unexpected"]),
          relatedChangesetFile: z.string().optional(),
          suggestedAction: z.enum(["update_test", "fix_code", "investigate"]),
        }),
      ),
      summary: z.string(),
    })
    .optional()
    .describe("Results of running related tests before planning"),
});

/**
 * Register the proposeTestPlan tool with the MCP server
 */
export function registerProposeTestPlan(server: McpServer): void {
  server.tool(
    "proposeTestPlan",
    "Output a structured test plan proposal in markdown format with YAML frontmatter. This tool should be used in PLAN MODE to present a comprehensive test strategy for user review before writing any test files.",
    ProposeTestPlanInputSchema.shape,
    async (input: z.infer<typeof ProposeTestPlanInputSchema>) => {
      try {
        const bridge = await ensureBridgeConnected();

        // Generate a unique tool call ID
        const toolCallId = `propose-plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        // Call the extension to handle the plan streaming
        const result = await bridge.call<{
          success: boolean;
          planId: string;
          filePath?: string;
          message: string;
        }>("proposeTestPlan", {
          ...input,
          toolCallId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: result.success,
                planId: result.planId,
                name: input.name,
                overview: input.overview,
                suites: input.suites,
                mockDependencies: input.mockDependencies,
                externalDependencies: input.externalDependencies,
                discoveredPatterns: input.discoveredPatterns,
                regressionAnalysis: input.regressionAnalysis,
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
                    : "Failed to propose test plan",
              }),
            },
          ],
        };
      }
    },
  );
}
