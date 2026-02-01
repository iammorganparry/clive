/**
 * @clive/memory - memory_get MCP Tool
 *
 * Read specific lines from a memory file.
 */

import { Effect } from "effect";
import type { MemoryGetOptions } from "../types.js";
import { MemoryService } from "../services/memory-service.js";

/**
 * Input schema for memory_get tool
 */
export interface MemoryGetInput {
  /** Path to the file (relative to .clive/memory/) */
  path: string;
  /** Starting line number (default: 1) */
  from?: number;
  /** Number of lines to read (default: all) */
  lines?: number;
}

/**
 * Tool definition for MCP
 */
export const memoryGetToolDefinition = {
  name: "memory_get",
  description:
    "Read specific lines from a memory file. Use this to retrieve context from daily logs or long-term memory.",
  inputSchema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description:
          "Path to the file relative to .clive/memory/ (e.g., 'daily/2026-01-27.md' or 'long-term/MEMORY.md')",
      },
      from: {
        type: "number",
        description: "Starting line number (1-based). Default: 1",
      },
      lines: {
        type: "number",
        description:
          "Number of lines to read. If not specified, reads the entire file.",
      },
    },
    required: ["path"],
  },
};

/**
 * Execute the memory_get tool
 */
export const executeMemoryGet = (input: MemoryGetInput) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;

    const options: MemoryGetOptions = {
      path: input.path,
      from: input.from,
      lines: input.lines,
    };

    const result = yield* memory.getMemoryFile(options);

    // Format the result for display
    const header = `File: ${input.path} (lines ${result.startLine}-${result.endLine} of ${result.totalLines})`;
    const separator = "─".repeat(Math.min(header.length, 60));

    return {
      content: `${header}\n${separator}\n${result.content}`,
      metadata: {
        path: input.path,
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
      },
    };
  });

/**
 * Handle memory_get tool call
 */
export const handleMemoryGet = (input: unknown) =>
  Effect.gen(function* () {
    // Validate input
    const validatedInput = input as MemoryGetInput;

    if (!validatedInput.path || typeof validatedInput.path !== "string") {
      return yield* Effect.fail(new Error("Invalid input: path is required"));
    }

    const result = yield* executeMemoryGet(validatedInput);

    return {
      type: "text" as const,
      text: result.content,
    };
  });
