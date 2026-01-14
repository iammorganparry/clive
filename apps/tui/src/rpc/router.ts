import { createRouter } from "@clive/webview-rpc";
import { Effect } from "effect";
import { z } from "zod";
import type { RpcContext } from "./context.js";

const { router, procedure } = createRouter<RpcContext>();

/**
 * TUI RPC Router
 *
 * Defines procedures for:
 * - Build operations (start, cancel)
 * - Plan operations (start)
 * - Task operations (list, ready)
 * - Epic operations (list)
 */
export const tuiRouter = router({
  build: {
    /**
     * Start a build execution with streaming output
     */
    start: procedure
      .input(
        z.object({
          args: z.array(z.string()),
          epicId: z.string().optional(),
        }),
      )
      .subscription(async function* ({ input, signal, ctx }) {
        const { args, epicId } = input;

        // Create abort handler
        let killed = false;
        signal.addEventListener("abort", () => {
          killed = true;
          ctx.killCurrentProcess();
        });

        // Start the build process
        const handle = ctx.runBuild(args, epicId);

        // Stream output as subscription updates
        const outputQueue: string[] = [];
        let resolveWait: (() => void) | null = null;
        let exitCode: number | null = null;

        handle.onData((data: string) => {
          outputQueue.push(data);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        });

        handle.onExit((code: number) => {
          exitCode = code;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        });

        // Yield output chunks as they arrive
        while (!killed && exitCode === null) {
          if (outputQueue.length > 0) {
            const chunk = outputQueue.shift();
            if (chunk !== undefined) {
              yield { type: "output" as const, text: chunk };
            }
          } else {
            // Wait for more data or exit
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }
        }

        // Drain remaining output
        while (outputQueue.length > 0) {
          const chunk = outputQueue.shift();
          if (chunk !== undefined) {
            yield { type: "output" as const, text: chunk };
          }
        }

        // Return final status
        return {
          type: "complete" as const,
          exitCode: exitCode ?? (killed ? -1 : 0),
          killed,
        };
      }),

    /**
     * Cancel the current build
     */
    cancel: procedure.input(z.object({})).mutation(({ ctx }) =>
      Effect.sync(() => {
        ctx.cancelBuild();
        return { success: true };
      }),
    ),
  },

  plan: {
    /**
     * Start a planning session with streaming output
     */
    start: procedure
      .input(
        z.object({
          args: z.array(z.string()),
        }),
      )
      .subscription(async function* ({ input, signal, ctx }) {
        const { args } = input;

        // Create abort handler
        let killed = false;
        signal.addEventListener("abort", () => {
          killed = true;
          ctx.killCurrentProcess();
        });

        // Start the plan process
        const handle = ctx.runPlan(args);

        // Stream output as subscription updates
        const outputQueue: string[] = [];
        let resolveWait: (() => void) | null = null;
        let exitCode: number | null = null;

        handle.onData((data: string) => {
          outputQueue.push(data);
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        });

        handle.onExit((code: number) => {
          exitCode = code;
          if (resolveWait) {
            resolveWait();
            resolveWait = null;
          }
        });

        // Yield output chunks as they arrive
        while (!killed && exitCode === null) {
          if (outputQueue.length > 0) {
            const chunk = outputQueue.shift();
            if (chunk !== undefined) {
              yield { type: "output" as const, text: chunk };
            }
          } else {
            // Wait for more data or exit
            await new Promise<void>((resolve) => {
              resolveWait = resolve;
            });
          }
        }

        // Drain remaining output
        while (outputQueue.length > 0) {
          const chunk = outputQueue.shift();
          if (chunk !== undefined) {
            yield { type: "output" as const, text: chunk };
          }
        }

        // Return final status
        return {
          type: "complete" as const,
          exitCode: exitCode ?? (killed ? -1 : 0),
          killed,
        };
      }),
  },

  tasks: {
    /**
     * Get all tasks for an epic
     */
    list: procedure
      .input(
        z.object({
          epicId: z.string().optional(),
        }),
      )
      .query(({ input, ctx }) =>
        Effect.sync(() => {
          if (input.epicId) {
            return ctx.getEpicTasks(input.epicId);
          }
          return ctx.getAllTasks();
        }),
      ),

    /**
     * Get tasks that are ready to execute
     */
    ready: procedure.input(z.object({})).query(({ ctx }) =>
      Effect.sync(() => {
        return ctx.getReadyTasks();
      }),
    ),
  },

  epics: {
    /**
     * Get all epics (P0 issues representing work plans)
     */
    list: procedure.input(z.object({})).query(({ ctx }) =>
      Effect.sync(() => {
        return ctx.getEpics();
      }),
    ),
  },
});

export type TuiRouter = typeof tuiRouter;
