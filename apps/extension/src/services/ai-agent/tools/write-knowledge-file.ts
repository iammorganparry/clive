import { tool } from "ai";
import { z } from "zod";
import { Effect, Layer, Runtime } from "effect";
import {
  KnowledgeFileError,
  KnowledgeFileService,
} from "../../knowledge-file-service.js";
import { VSCodeService } from "../../vs-code.js";
import {
  KnowledgeBaseCategorySchema,
  type KnowledgeBaseCategory,
} from "../../../constants.js";
import { extractErrorMessage } from "../../../utils/error-utils.js";

/**
 * Create a writeKnowledgeFile tool that stores knowledge entries as markdown files
 */
export const createWriteKnowledgeFileTool = (
  knowledgeFileService: KnowledgeFileService,
  onComplete?: (category: string, success: boolean) => void,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description: `Store a knowledge base entry as a markdown file. Use this to document any valuable 
    discovery about the codebase - architecture, components, user journeys, data models, API integrations, 
    testing patterns, error handling, security, or any other insights that would help understand the codebase.
    
    Choose a descriptive category name that makes sense for this codebase (e.g., "authentication-flow", 
    "payment-integration", "component-composition"). Each entry should include concrete examples and file references.
    
    Knowledge files are stored in .clive/knowledge/ and can be committed to version control.`,
    inputSchema: z.object({
      category: KnowledgeBaseCategorySchema.describe(
        "Category name for this knowledge entry (e.g., 'architecture', 'user-journeys', 'api-integrations'). Choose a descriptive name that makes sense for this codebase.",
      ),
      title: z
        .string()
        .describe("Short, descriptive title for this knowledge entry"),
      content: z
        .string()
        .describe(
          "Detailed description of the testing pattern, framework configuration, or convention",
        ),
      examples: z
        .array(z.string())
        .optional()
        .describe("Code examples demonstrating this pattern"),
      sourceFiles: z
        .array(z.string())
        .optional()
        .describe("File paths where this knowledge was discovered"),
      append: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "If true, append to existing file instead of overwriting (useful for multiple entries in same category)",
        ),
    }),
    execute: async ({
      category,
      title,
      content,
      examples = [],
      sourceFiles = [],
      append = false,
    }: {
      category: KnowledgeBaseCategory;
      title: string;
      content: string;
      examples?: string[];
      sourceFiles?: string[];
      append?: boolean;
    }): Promise<
      | { success: true; path: string; relativePath: string }
      | { success: false; error: string }
    > => {
      console.log(
        `[WriteKnowledgeFile] Starting for category: ${category}, title: ${title.substring(0, 50)}...`,
      );

      try {
        const result = await Runtime.runPromise(runtime)(
          knowledgeFileService
            .writeKnowledgeFile(category, title, content, {
              examples,
              sourceFiles,
              append,
            })
            .pipe(
              Effect.catchAll((error) =>
                Effect.fail(
                  new KnowledgeFileError({
                    message: `Failed to write knowledge file: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
                ),
              ),
              Effect.provide(
                Layer.merge(KnowledgeFileService.Default, VSCodeService.Default),
              ),
            ),
        );

        console.log(
          `[WriteKnowledgeFile] Successfully wrote to ${result.relativePath}`,
        );
        onComplete?.(category, true);
        return {
          success: true,
          path: result.path,
          relativePath: result.relativePath,
        };
      } catch (error) {
        const errorMessage = extractErrorMessage(error);
        console.error(`[WriteKnowledgeFile] Error: ${errorMessage}`);
        onComplete?.(category, false);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
  });
};
