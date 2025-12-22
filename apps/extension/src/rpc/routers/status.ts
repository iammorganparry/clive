import { Effect } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { ReactFileFilter as ReactFileFilterService } from "../../services/react-file-filter.js";
import { createSystemServiceLayer } from "../../services/layer-factory.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

/**
 * Get the system layer - uses override if provided, otherwise creates default.
 * Returns a function that can be used with Effect.provide in a pipe.
 */
const provideSystemLayer = (ctx: RpcContext) => {
  const layer = ctx.systemLayer ?? createSystemServiceLayer(ctx.layerContext);
  return <A, E>(effect: Effect.Effect<A, E, unknown>) =>
    effect.pipe(Effect.provide(layer)) as Effect.Effect<A, E, never>;
};

/**
 * Status router - handles status queries
 */
export const statusRouter = {
  /**
   * Get Cypress installation status
   */
  cypress: procedure.input(z.void()).query(({ ctx }) => {
    return Effect.gen(function* () {
      const status = yield* Effect.tryPromise({
        try: () => ctx.cypressDetector.checkStatus(),
        catch: (error) =>
          new Error(error instanceof Error ? error.message : "Unknown error"),
      });

      if (!status) {
        return {
          overallStatus: "not_installed" as const,
          packages: [],
          workspaceRoot: "",
        };
      }

      return status;
    });
  }),

  /**
   * Get branch changes
   */
  branchChanges: procedure.input(z.void()).query(({ ctx }) => {
    return Effect.gen(function* () {
      const branchChanges = yield* ctx.gitService.getBranchChanges();

      if (!branchChanges) {
        return null;
      }

      const reactFileFilter = yield* ReactFileFilterService;
      const eligibleFiles = yield* reactFileFilter.filterEligibleFiles(
        branchChanges.files,
      );

      return {
        branchName: branchChanges.branchName,
        baseBranch: branchChanges.baseBranch,
        files: eligibleFiles,
        workspaceRoot: branchChanges.workspaceRoot,
      };
    }).pipe(provideSystemLayer(ctx));
  }),
};
