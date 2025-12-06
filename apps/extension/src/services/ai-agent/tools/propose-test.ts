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
  }),
  execute: async ({
    sourceFile,
    targetTestPath,
    description,
    isUpdate,
  }: ProposeTestInput): Promise<ProposeTestOutput> => {
    // Generate a unique ID for this proposal
    const id = `${sourceFile}-${targetTestPath}-${Date.now()}`;

    return {
      success: true,
      id,
      message: `Proposed ${isUpdate ? "update" : "creation"} of test file: ${targetTestPath} for ${sourceFile}`,
    };
  },
});
