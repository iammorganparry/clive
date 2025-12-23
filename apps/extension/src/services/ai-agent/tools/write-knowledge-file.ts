import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime } from "effect";
import { KnowledgeFileService } from "../../knowledge-file-service.js";
import {
  KnowledgeBaseCategorySchema,
  type KnowledgeBaseCategory,
} from "../../../constants.js";

/**
 * Create a writeKnowledgeFile tool that stores knowledge entries as markdown files
 */
export const createWriteKnowledgeFileTool = (
  knowledgeFileService: KnowledgeFileService,
  onComplete?: (category: string, success: boolean) => void,
) => {
  const runtime = Runtime.defaultRuntime;

  return tool({
    description: `Store a knowledge base entry for this repository's testing patterns as a markdown file.
    Use this after discovering and analyzing testing patterns, frameworks, mocks, fixtures, etc.
    Also use this to record gaps (missing mocks, fixtures, test coverage) and improvements (suggestions for better testing practices).
    Each entry should be focused on a specific category and include concrete examples.
    Categories: framework, patterns, mocks, fixtures, selectors, routes, assertions, hooks, utilities, coverage, gaps, improvements.
    
    Knowledge files are stored in .clive/knowledge/ and can be committed to version control.`,
    inputSchema: z.object({
      category: KnowledgeBaseCategorySchema.describe(
        "Category of knowledge entry",
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
    }): Promise<{
      success: boolean;
      path?: string;
      relativePath?: string;
      error?: string;
    }> => {
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
            .pipe(Effect.provide(KnowledgeFileService.Default)),
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
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
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
