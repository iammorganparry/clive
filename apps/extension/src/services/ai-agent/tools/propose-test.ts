import { tool } from "ai";
import { z } from "zod";
import type { ProposeTestInput, ProposeTestOutput } from "../types.js";

/**
 * Tool for proposing a test file without writing it
 * Used during the planning phase to gather test proposals
 */
export const proposeTestTool = tool({
  description:
    "Propose a Cypress test file to be created or updated. This does NOT write the file - it only records the proposal for user approval.",
  inputSchema: z.object({
    sourceFile: z
      .string()
      .describe(
        "The source React component file path that this test will cover",
      ),
    targetTestPath: z
      .string()
      .describe(
        "The proposed target path for the Cypress test file (relative to workspace root)",
      ),
    description: z
      .string()
      .describe(
        "A brief description of what this test will cover (e.g., 'Tests login form interactions and validation')",
      ),
    isUpdate: z
      .boolean()
      .describe(
        "Whether this will update an existing test file (true) or create a new one (false)",
      ),
    // E2E-specific fields
    navigationPath: z
      .string()
      .optional()
      .describe(
        "The URL/route to navigate to in the test (e.g., '/login', '/dashboard'). This is critical for E2E tests - always identify the navigation path.",
      ),
    pageContext: z
      .string()
      .optional()
      .describe(
        "The page component that contains this feature (e.g., 'LoginPage', 'DashboardPage'). Helps understand the application context.",
      ),
    prerequisites: z
      .array(z.string())
      .optional()
      .describe(
        "Prerequisites needed before the test can run (e.g., ['user must be logged in', 'test data must exist']). Critical for E2E test setup.",
      ),
    relatedTests: z
      .array(z.string())
      .optional()
      .describe(
        "Paths to existing test files that may be impacted by this change. Found via semantic search or file discovery.",
      ),
    userFlow: z
      .string()
      .optional()
      .describe(
        "Description of the complete E2E user journey being tested (e.g., 'User logs in, navigates to dashboard, views their profile'). Think about the full user experience, not just the component.",
      ),
  }),
  execute: async ({
    sourceFile,
    targetTestPath,
    description: _description,
    isUpdate,
    navigationPath,
    pageContext,
    prerequisites,
    relatedTests,
    userFlow,
  }: ProposeTestInput): Promise<ProposeTestOutput> => {
    // Generate a unique ID for this proposal
    const id = `${sourceFile}-${targetTestPath}-${Date.now()}`;

    const e2eInfo = [];
    if (navigationPath) {
      e2eInfo.push(`navigation: ${navigationPath}`);
    }
    if (pageContext) {
      e2eInfo.push(`page: ${pageContext}`);
    }
    if (prerequisites && prerequisites.length > 0) {
      e2eInfo.push(`prerequisites: ${prerequisites.join(", ")}`);
    }
    if (relatedTests && relatedTests.length > 0) {
      e2eInfo.push(`related tests: ${relatedTests.length} found`);
    }
    if (userFlow) {
      e2eInfo.push(`user flow: ${userFlow}`);
    }

    const e2eDetails =
      e2eInfo.length > 0 ? ` (E2E: ${e2eInfo.join("; ")})` : "";

    return {
      success: true,
      id,
      message: `Proposed ${isUpdate ? "update" : "creation"} of test file: ${targetTestPath} for ${sourceFile}${e2eDetails}`,
    };
  },
});
