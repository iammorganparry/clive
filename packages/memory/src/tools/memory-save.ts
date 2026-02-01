/**
 * @clive/memory - memory_save MCP Tool
 *
 * Save important information to today's daily memory log.
 */

import { Effect } from "effect";
import type { MemoryCategory, MemoryEntry } from "../types.js";
import { MemoryService } from "../services/memory-service.js";
import { getTodayDate } from "../utils/file-utils.js";

/**
 * Input schema for memory_save tool
 */
export interface MemorySaveInput {
  /** Category of the entry */
  category: MemoryCategory;
  /** The content to save */
  content: string;
  /** Optional tags for organization */
  tags?: string[];
}

/**
 * Tool definition for MCP
 */
export const memorySaveToolDefinition = {
  name: "memory_save",
  description:
    "Save important information to today's memory log. Use this to record decisions, patterns, gotchas, or notes for future reference.",
  inputSchema: {
    type: "object" as const,
    properties: {
      category: {
        type: "string",
        enum: ["decision", "pattern", "gotcha", "note"],
        description:
          "Category of the entry: 'decision' for architectural/implementation decisions, 'pattern' for discovered code patterns, 'gotcha' for bugs/workarounds found, 'note' for general observations",
      },
      content: {
        type: "string",
        description:
          "The content to save. Should be concise but include enough context to be useful later.",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional tags for organization and filtering (e.g., ['auth', 'api', 'bugfix'])",
      },
    },
    required: ["category", "content"],
  },
};

/**
 * Validate category is a valid MemoryCategory
 */
function isValidCategory(category: string): category is MemoryCategory {
  return ["decision", "pattern", "gotcha", "note"].includes(category);
}

/**
 * Execute the memory_save tool
 */
export const executeMemorySave = (input: MemorySaveInput) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    const entry: MemoryEntry = {
      category: input.category,
      content: input.content,
      tags: input.tags,
    };

    yield* memory.saveToDaily(entry);

    const today = getTodayDate();
    const tagsStr = input.tags?.length ? ` [${input.tags.join(", ")}]` : "";

    return {
      success: true,
      message: `Saved ${input.category} to daily/${today}.md${tagsStr}`,
      metadata: {
        category: input.category,
        date: today,
        tags: input.tags,
        contentLength: input.content.length,
      },
    };
  });

/**
 * Handle memory_save tool call
 */
export const handleMemorySave = (input: unknown) =>
  Effect.gen(function* () {
    // Validate input
    const validatedInput = input as MemorySaveInput;

    if (
      !validatedInput.category ||
      typeof validatedInput.category !== "string"
    ) {
      return yield* Effect.fail(
        new Error("Invalid input: category is required"),
      );
    }

    if (!isValidCategory(validatedInput.category)) {
      return yield* Effect.fail(
        new Error(
          "Invalid input: category must be one of: decision, pattern, gotcha, note",
        ),
      );
    }

    if (!validatedInput.content || typeof validatedInput.content !== "string") {
      return yield* Effect.fail(
        new Error("Invalid input: content is required"),
      );
    }

    const result = yield* executeMemorySave(validatedInput);

    return {
      type: "text" as const,
      text: result.message,
    };
  });
