import { Effect, Layer } from "effect";
import { z } from "zod";
import { createRouter } from "@clive/webview-rpc";
import { ReactFileFilter as ReactFileFilterService } from "../../services/react-file-filter.js";
import { VSCodeService } from "../../services/vs-code.js";
import type { RpcContext } from "../context.js";

const { procedure } = createRouter<RpcContext>();

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
    }).pipe(
      Effect.provide(
        Layer.mergeAll(ReactFileFilterService.Default, VSCodeService.Default),
      ),
    );
  }),
};
