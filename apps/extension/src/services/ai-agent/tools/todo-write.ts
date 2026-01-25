/**
 * TodoWrite Tool
 *
 * Mirrors Claude Code's native TodoWrite tool for tracking test suite progress.
 * Used by the Ralph Wiggum loop to track which test suites are pending/complete.
 *
 * This tool allows the agent to:
 * - Mark tasks as in_progress before starting work
 * - Mark tasks as completed when tests pass
 * - Track overall progress across multiple test suites
 */

import { tool } from "ai";
import { Effect, Ref, Runtime } from "effect";
import { z } from "zod";
import { logToOutput } from "../../../utils/logger.js";
import type { ProgressCallback } from "../event-handlers.js";
import {
  type LoopState,
  type TodoItem,
  updateTodosFromInput,
} from "../loop-state.js";

/**
 * Input schema for TodoWrite tool
 * Mirrors Claude Code's native TodoWrite schema
 */
const TodoWriteInputSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z
          .string()
          .min(1)
          .describe(
            "What needs to be done (imperative form, e.g., 'Write unit tests for auth.ts')",
          ),
        status: z
          .enum(["pending", "in_progress", "completed"])
          .describe("Current status of this task"),
        activeForm: z
          .string()
          .min(1)
          .describe(
            "Present continuous form shown during execution (e.g., 'Writing unit tests for auth.ts')",
          ),
      }),
    )
    .describe(
      "The updated todo list. IMPORTANT: Include ALL todos, not just changed ones.",
    ),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

/**
 * Output from TodoWrite tool
 */
export interface TodoWriteOutput {
  success: boolean;
  message: string;
  todos: Array<{
    content: string;
    status: string;
    activeForm: string;
  }>;
  progress: {
    completed: number;
    pending: number;
    total: number;
    percentComplete: number;
  };
}

/**
 * Convert TodoItem array to display format for UI
 */
const todosToDisplayFormat = (
  todos: TodoItem[],
): Array<{ content: string; status: string; activeForm: string }> =>
  todos.map((t) => ({
    content: t.content,
    status: t.status,
    activeForm: t.activeForm,
  }));

/**
 * Calculate progress from todos
 */
const calculateProgress = (
  todos: TodoItem[],
): {
  completed: number;
  pending: number;
  total: number;
  percentComplete: number;
} => {
  const completed = todos.filter((t) => t.status === "completed").length;
  const pending = todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  ).length;
  const total = todos.length;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, pending, total, percentComplete };
};

/**
 * Create the TodoWrite tool
 *
 * @param loopStateRef - Reference to the loop state for updating todos
 * @param progressCallback - Optional callback for emitting progress to UI
 */
export const createTodoWriteTool = (
  loopStateRef: Ref.Ref<LoopState>,
  progressCallback?: ProgressCallback,
) =>
  tool({
    description: `Use this tool to track progress on test suite implementation.

## When to Use
- ALWAYS use this tool when starting work on a test suite (mark as in_progress)
- ALWAYS use this tool when completing a test suite (mark as completed)
- Use to update the status of multiple suites at once

## Important Rules
1. Mark exactly ONE task as in_progress at a time
2. Only mark a task as completed when ALL tests in that suite pass
3. Include ALL todos in the update, not just the changed ones
4. Update task status in real-time as you work

## Example Usage
Starting a task:
{
  "todos": [
    { "content": "Write unit tests for auth.ts", "status": "in_progress", "activeForm": "Writing unit tests for auth.ts" },
    { "content": "Write integration tests for api.ts", "status": "pending", "activeForm": "Writing integration tests for api.ts" }
  ]
}

Completing a task:
{
  "todos": [
    { "content": "Write unit tests for auth.ts", "status": "completed", "activeForm": "Writing unit tests for auth.ts" },
    { "content": "Write integration tests for api.ts", "status": "in_progress", "activeForm": "Writing integration tests for api.ts" }
  ]
}`,
    inputSchema: TodoWriteInputSchema,
    execute: async (input: TodoWriteInput): Promise<TodoWriteOutput> => {
      const program = Effect.gen(function* () {
        logToOutput(`[TodoWrite] Updating ${input.todos.length} todos`);

        // Validate: only one in_progress at a time
        const inProgressCount = input.todos.filter(
          (t: { status: string }) => t.status === "in_progress",
        ).length;

        if (inProgressCount > 1) {
          logToOutput(
            `[TodoWrite] Warning: ${inProgressCount} tasks marked as in_progress. Should be at most 1.`,
          );
        }

        // Update the loop state with new todos
        const updatedState = yield* Ref.updateAndGet(loopStateRef, (state) =>
          updateTodosFromInput(state, input.todos),
        );

        const progress = calculateProgress(updatedState.todos);
        const displayTodos = todosToDisplayFormat(updatedState.todos);

        logToOutput(
          `[TodoWrite] Progress: ${progress.completed}/${progress.total} (${progress.percentComplete}%)`,
        );

        // Emit progress to UI
        if (progressCallback) {
          progressCallback(
            "todos-updated",
            JSON.stringify({
              type: "todos-updated",
              todos: displayTodos,
              progress,
            }),
          );
        }

        // Check if all completed
        if (updatedState.allTestsPassed) {
          logToOutput("[TodoWrite] All tests passed!");
        }

        return {
          success: true,
          message: `Updated ${input.todos.length} todos. Progress: ${progress.completed}/${progress.total} completed.`,
          todos: displayTodos,
          progress,
        };
      });

      return Runtime.runPromise(Runtime.defaultRuntime)(program);
    },
  });

/**
 * Default export for convenience
 * Note: Requires loopStateRef to be provided at runtime
 */
export default createTodoWriteTool;
