import * as vscode from "vscode";
import * as path from "node:path";
import { Effect, Data } from "effect";
import { VSCodeService } from "./vs-code.js";

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
        PlanFileError
      > =>
        Effect.gen(function* () {
          const workspaceFolders = vscodeService.workspace.workspaceFolders;
          if (!workspaceFolders || workspaceFolders.length === 0) {
            return yield* Effect.fail(
              new PlanFileError({
                message: "No workspace folder found",
              }),
            );
          }

          const workspaceRoot = workspaceFolders[0].uri;
          const cliveDir = vscode.Uri.joinPath(workspaceRoot, ".clive");
          const plansDir = vscode.Uri.joinPath(cliveDir, "plans");

          // Check if .clive directory exists, create if not
          const cliveExists = yield* Effect.tryPromise({
            try: async () => {
              await vscodeService.workspace.fs.stat(cliveDir);
              return true;
            },
            catch: () => false,
          }).pipe(Effect.catchAll(() => Effect.succeed(false)));

          if (!cliveExists) {
            yield* Effect.tryPromise({
              try: () => vscodeService.workspace.fs.createDirectory(cliveDir),
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to create .clive directory: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
          }

          // Check if plans directory exists, create if not
          const plansExists = yield* Effect.tryPromise({
            try: async () => {
              await vscodeService.workspace.fs.stat(plansDir);
              return true;
            },
            catch: () => false,
          }).pipe(Effect.catchAll(() => Effect.succeed(false)));

          if (!plansExists) {
            yield* Effect.tryPromise({
              try: () => vscodeService.workspace.fs.createDirectory(plansDir),
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to create .clive/plans directory: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
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
            const planUri = vscode.Uri.joinPath(plansDir, fileName);

            const frontmatter = `---
proposalId: "${metadata.proposalId}"
subscriptionId: "${metadata.subscriptionId}"
sourceFile: "${sourceFile}"
targetTestPath: "${metadata.targetTestPath}"
status: "${metadata.status || "pending"}"
createdAt: "${new Date().toISOString()}"
---

# Test Plan: ${path.basename(sourceFile)}

`;

            yield* Effect.tryPromise({
              try: async () => {
                const content = Buffer.from(frontmatter, "utf-8");
                await vscodeService.workspace.fs.writeFile(planUri, content);
              },
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to create plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });

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
            const existingContent = yield* Effect.tryPromise({
              try: async () => {
                const fileData =
                  await vscodeService.workspace.fs.readFile(planUri);
                return Buffer.from(fileData).toString("utf-8");
              },
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });

            // Append new content
            const newContent = existingContent + content;
            yield* Effect.tryPromise({
              try: async () => {
                const contentBuffer = Buffer.from(newContent, "utf-8");
                await vscodeService.workspace.fs.writeFile(
                  planUri,
                  contentBuffer,
                );
              },
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to append content: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
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
                message: `Failed to open plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
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
            const fileData = yield* Effect.tryPromise({
              try: () => vscodeService.workspace.fs.readFile(planUri),
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });

            const content = Buffer.from(fileData).toString("utf-8");

            // Update status in frontmatter
            const updatedContent = content.replace(
              /status: ".*"/,
              `status: "${status}"`,
            );

            yield* Effect.tryPromise({
              try: async () => {
                const contentBuffer = Buffer.from(updatedContent, "utf-8");
                await vscodeService.workspace.fs.writeFile(
                  planUri,
                  contentBuffer,
                );
              },
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to update plan status: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });
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
            const fileData = yield* Effect.tryPromise({
              try: () => vscodeService.workspace.fs.readFile(planUri),
              catch: (error) =>
                new PlanFileError({
                  message: `Failed to read plan file: ${error instanceof Error ? error.message : "Unknown error"}`,
                  cause: error,
                }),
            });

            const content = Buffer.from(fileData).toString("utf-8");

            const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
            if (!frontmatterMatch) {
              return yield* Effect.fail(
                new PlanFileError({
                  message: "No frontmatter found in plan file",
                }),
              );
            }

            const frontmatter = frontmatterMatch[1];
            const metadata: Record<string, string> = {};

            for (const line of frontmatter.split("\n")) {
              const match = line.match(/^(\w+):\s*"(.*)"$/);
              if (match) {
                metadata[match[1]] = match[2];
              }
            }

            if (
              !metadata.proposalId ||
              !metadata.subscriptionId ||
              !metadata.sourceFile ||
              !metadata.targetTestPath ||
              !metadata.status
            ) {
              return yield* Effect.fail(
                new PlanFileError({
                  message: "Invalid frontmatter: missing required fields",
                }),
              );
            }

            return {
              proposalId: metadata.proposalId,
              subscriptionId: metadata.subscriptionId,
              sourceFile: metadata.sourceFile,
              targetTestPath: metadata.targetTestPath,
              status: metadata.status as "pending" | "approved" | "rejected",
              createdAt: metadata.createdAt || new Date().toISOString(),
            };
          }),
      };
    }),
    dependencies: [VSCodeService.Default],
  },
) {}
