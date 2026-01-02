import * as vscode from "vscode";
import * as path from "node:path";
import { Effect, Data } from "effect";
import { VSCodeService } from "./vs-code.js";
import {
  parseFrontmatter,
  generateFrontmatter,
  isPlanStatus,
} from "../utils/frontmatter-utils.js";
import { extractErrorMessage } from "../utils/error-utils.js";

/**
 * Error types for plan file operations
 */
export class PlanFileError extends Data.TaggedError("PlanFileError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Service for managing test plan files in .clive/plans/ directory
 * Handles creation, streaming content, and opening plan files
 */
export class PlanFileService extends Effect.Service<PlanFileService>()(
  "PlanFileService",
  {
    effect: Effect.gen(function* () {
      const vscodeService = yield* VSCodeService;

      /**
       * Ensure the .clive/plans directory exists, creating .clive and .clive/plans if needed
       */
      const ensurePlansDirectory = (): Effect.Effect<
        vscode.Uri,
        PlanFileError,
        never
      > =>
        Effect.gen(function* () {
          const workspaceRoot = yield* vscodeService.getWorkspaceRoot().pipe(
            Effect.mapError(
              (_error): PlanFileError =>
                new PlanFileError({
                  message: "No workspace folder found",
                }),
            ),
          );

          const cliveDir = vscodeService.joinPath(workspaceRoot, ".clive");
          const plansDir = vscodeService.joinPath(cliveDir, "plans");

          // Ensure directories exist
          // Check if .clive directory exists, create if not
          const cliveExists = yield* vscodeService
            .isDirectory(cliveDir)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));

          if (!cliveExists) {
            yield* vscodeService.createDirectory(cliveDir).pipe(
              Effect.mapError(
                (error) =>
                  new PlanFileError({
                    message: `Failed to create .clive directory: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );
          }

          // Check if plans directory exists, create if not
          const plansExists = yield* vscodeService
            .isDirectory(plansDir)
            .pipe(Effect.catchAll(() => Effect.succeed(false)));

          if (!plansExists) {
            yield* vscodeService.createDirectory(plansDir).pipe(
              Effect.mapError(
                (error) =>
                  new PlanFileError({
                    message: `Failed to create .clive/plans directory: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );
          }

          return plansDir;
        });

      /**
       * Generate a timestamped filename for a plan file
       */
      const generatePlanFileName = (sourceFile: string): string => {
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, -5); // Remove milliseconds and timezone
        const baseName = path.basename(sourceFile, path.extname(sourceFile));
        return `${baseName}-${timestamp}.md`;
      };

      return {
        /**
         * Create a new plan file with frontmatter
         */
        createPlanFile: (
          sourceFile: string,
          metadata: {
            proposalId: string;
            subscriptionId: string;
            targetTestPath: string;
            status?: "pending" | "approved" | "rejected";
          },
        ): Effect.Effect<vscode.Uri, PlanFileError> =>
          Effect.gen(function* () {
            const plansDir = yield* ensurePlansDirectory();
            const fileName = generatePlanFileName(sourceFile);
            const planUri = vscodeService.joinPath(plansDir, fileName);

            const frontmatterContent = generateFrontmatter({
              proposalId: metadata.proposalId,
              subscriptionId: metadata.subscriptionId,
              sourceFile,
              targetTestPath: metadata.targetTestPath,
              status: metadata.status || "pending",
              createdAt: new Date().toISOString(),
            });

            const frontmatter = `${frontmatterContent}# Test Plan: ${path.basename(sourceFile)}

`;

            yield* vscodeService
              .writeFile(planUri, Buffer.from(frontmatter, "utf-8"))
              .pipe(
                Effect.mapError(
                  (error) =>
                    new PlanFileError({
                      message: `Failed to create plan file: ${extractErrorMessage(error)}`,
                      cause: error,
                    }),
                ),
              );

            return planUri;
          }),

        /**
         * Append content to an existing plan file
         */
        appendContent: (
          planUri: vscode.Uri,
          content: string,
        ): Effect.Effect<void, PlanFileError> =>
          Effect.gen(function* () {
            // Read existing content
            const existingContent = yield* vscodeService
              .readFileAsString(planUri)
              .pipe(
                Effect.mapError(
                  (error) =>
                    new PlanFileError({
                      message: `Failed to read plan file: ${extractErrorMessage(error)}`,
                      cause: error,
                    }),
                ),
              );

            // Append new content
            const newContent = existingContent + content;
            yield* vscodeService
              .writeFile(planUri, Buffer.from(newContent, "utf-8"))
              .pipe(
                Effect.mapError(
                  (error) =>
                    new PlanFileError({
                      message: `Failed to append content: ${extractErrorMessage(error)}`,
                      cause: error,
                    }),
                ),
              );
          }),

        /**
         * Open a plan file in the VS Code editor as Markdown preview
         */
        openPlanFile: (
          planUri: vscode.Uri,
        ): Effect.Effect<void, PlanFileError> =>
          Effect.tryPromise({
            try: async () => {
              // Open as Markdown preview (rendered, not source)
              await vscode.commands.executeCommand(
                "markdown.showPreview",
                planUri,
              );
            },
            catch: (error) =>
              new PlanFileError({
                message: `Failed to open plan file: ${extractErrorMessage(error)}`,
                cause: error,
              }),
          }),

        /**
         * Update plan file status in frontmatter
         */
        updatePlanStatus: (
          planUri: vscode.Uri,
          status: "pending" | "approved" | "rejected",
        ): Effect.Effect<void, PlanFileError> =>
          Effect.gen(function* () {
            const content = yield* vscodeService.readFileAsString(planUri).pipe(
              Effect.mapError(
                (error) =>
                  new PlanFileError({
                    message: `Failed to read plan file: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );

            // Update status in frontmatter
            const updatedContent = content.replace(
              /status: ".*"/,
              `status: "${status}"`,
            );

            yield* vscodeService
              .writeFile(planUri, Buffer.from(updatedContent, "utf-8"))
              .pipe(
                Effect.mapError(
                  (error) =>
                    new PlanFileError({
                      message: `Failed to update plan status: ${extractErrorMessage(error)}`,
                      cause: error,
                    }),
                ),
              );
          }),

        /**
         * Parse frontmatter from a plan file
         */
        parseFrontmatter: (
          planUri: vscode.Uri,
        ): Effect.Effect<
          {
            proposalId: string;
            subscriptionId: string;
            sourceFile: string;
            targetTestPath: string;
            status: "pending" | "approved" | "rejected";
            createdAt: string;
          },
          PlanFileError
        > =>
          Effect.gen(function* () {
            const content = yield* vscodeService.readFileAsString(planUri).pipe(
              Effect.mapError(
                (error) =>
                  new PlanFileError({
                    message: `Failed to read plan file: ${extractErrorMessage(error)}`,
                    cause: error,
                  }),
              ),
            );

            const { frontmatter } = parseFrontmatter(content);

            if (
              !frontmatter.proposalId ||
              !frontmatter.subscriptionId ||
              !frontmatter.sourceFile ||
              !frontmatter.targetTestPath ||
              !frontmatter.status
            ) {
              return yield* Effect.fail(
                new PlanFileError({
                  message: "Invalid frontmatter: missing required fields",
                }),
              );
            }

            // Validate status with type guard
            if (!isPlanStatus(frontmatter.status)) {
              return yield* Effect.fail(
                new PlanFileError({
                  message: `Invalid frontmatter: invalid status "${frontmatter.status}"`,
                }),
              );
            }

            return {
              proposalId: String(frontmatter.proposalId),
              subscriptionId: String(frontmatter.subscriptionId),
              sourceFile: String(frontmatter.sourceFile),
              targetTestPath: String(frontmatter.targetTestPath),
              status: frontmatter.status,
              createdAt:
                (frontmatter.createdAt as string) || new Date().toISOString(),
            };
          }),
      };
    }),
    dependencies: [VSCodeService.Default],
  },
) {}
