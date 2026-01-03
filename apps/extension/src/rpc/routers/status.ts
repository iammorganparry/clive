import { Effect } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { SourceFileFilter as SourceFileFilterService } from "../../services/source-file-filter.js";
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
   * Get branch changes
   */
  branchChanges: procedure.input(z.void()).query(({ ctx }) => {
    return Effect.gen(function* () {
      const branchChanges = yield* ctx.gitService.getBranchChanges();

      if (!branchChanges) {
        return null;
      }

      const sourceFileFilter = yield* SourceFileFilterService;
      const eligibleFiles = yield* sourceFileFilter.filterEligibleFiles(
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

  /**
   * Get uncommitted changes (staged + unstaged files only)
   */
  uncommittedChanges: procedure.input(z.void()).query(({ ctx }) => {
    return Effect.gen(function* () {
      const uncommittedChanges = yield* ctx.gitService.getUncommittedChanges();

      if (!uncommittedChanges) {
        return null;
      }

      const sourceFileFilter = yield* SourceFileFilterService;
      const eligibleFiles = yield* sourceFileFilter.filterEligibleFiles(
        uncommittedChanges.files,
      );

      return {
        branchName: uncommittedChanges.branchName,
        baseBranch: uncommittedChanges.baseBranch,
        files: eligibleFiles,
        workspaceRoot: uncommittedChanges.workspaceRoot,
      };
    }).pipe(provideSystemLayer(ctx));
  }),

  /**
   * Get current HEAD commit hash
   * Returns null if no workspace folder is open or git command fails
   */
  currentCommit: procedure.input(z.void()).query(({ ctx }) => {
    return Effect.gen(function* () {
      const commitHash = yield* ctx.gitService.getCurrentCommitHash();
      return { commitHash };
    }).pipe(
      Effect.catchAll(() => Effect.succeed({ commitHash: null })),
      provideSystemLayer(ctx),
    );
  }),
};
