/**
 * Service for managing knowledge base files in the filesystem
 * Stores knowledge as markdown files in .clive/knowledge/ directory
 */

import { Data, Effect } from "effect";
import * as vscode from "vscode";
import type { KnowledgeBaseCategory } from "../constants.js";
import {
  findFilesEffect,
  getWorkspaceRoot,
  readFileAsStringEffect,
  statFileEffect,
} from "../lib/vscode-effects.js";
import {
  parseFrontmatter,
  generateFrontmatter as generateFrontmatterUtil,
} from "../utils/frontmatter-utils.js";
import { ensureDirectoryExists } from "../utils/fs-effects.js";
import { extractErrorMessage } from "../utils/error-utils.js";

/**
 * Error types for knowledge file operations
 */
export class KnowledgeFileError extends Data.TaggedError("KnowledgeFileError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Knowledge file metadata from frontmatter
 */
export interface KnowledgeFileMetadata {
  category: KnowledgeBaseCategory;
  title: string;
  sourceFiles?: string[];
  updatedAt: string;
}

/**
 * Knowledge file content with metadata
 */
export interface KnowledgeFile {
  path: string;
  relativePath: string;
  metadata: KnowledgeFileMetadata;
  content: string;
}

/**
 * Service for managing knowledge base files
 */
export class KnowledgeFileService extends Effect.Service<KnowledgeFileService>()(
  "KnowledgeFileService",
  {
    effect: Effect.gen(function* () {
      /**
       * Get the knowledge base directory path
       */
      const getKnowledgeDir = () =>
        Effect.gen(function* () {
          const workspaceRoot = yield* getWorkspaceRoot();
          return vscode.Uri.joinPath(workspaceRoot, ".clive", "knowledge");
        });

      /**
       * Ensure knowledge directory exists, creating it if needed
       */
      const ensureKnowledgeDir = () =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();
          return yield* ensureDirectoryExists(knowledgeDir).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new KnowledgeFileError({
                  message: `Failed to create knowledge directory: ${extractErrorMessage(error)}`,
                  cause: error,
                }),
              ),
            ),
          );
        });

      /**
       * Generate frontmatter string from metadata
       */
      const generateFrontmatter = (metadata: KnowledgeFileMetadata): string => {
        return generateFrontmatterUtil({
          category: metadata.category,
          title: metadata.title,
          sourceFiles: metadata.sourceFiles,
          updatedAt: metadata.updatedAt,
        });
      };

      /**
       * Get file path for a category
       * Uses directory structure: each category gets its own directory
       * Articles within a category are separate files named by title
       */
      const getCategoryPath = (
        category: KnowledgeBaseCategory,
        knowledgeDir: vscode.Uri,
      ): vscode.Uri => {
        // Sanitize category name for directory
        const sanitizedCategory = category
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        return vscode.Uri.joinPath(knowledgeDir, sanitizedCategory);
      };

      /**
       * Write a knowledge file for a category
       */
      const writeKnowledgeFile = (
        category: KnowledgeBaseCategory,
        title: string,
        content: string,
        options?: {
          examples?: string[];
          sourceFiles?: string[];
          append?: boolean; // Append to existing file instead of overwriting
        },
      ) =>
        Effect.gen(function* () {
          const knowledgeDir = yield* ensureKnowledgeDir();
          const categoryPath = getCategoryPath(category, knowledgeDir);

          // Ensure category directory exists
          yield* ensureDirectoryExists(categoryPath).pipe(
            Effect.catchAll((error) =>
              Effect.fail(
                new KnowledgeFileError({
                  message: `Failed to create category directory: ${extractErrorMessage(error)}`,
                  cause: error,
                }),
              ),
            ),
          );

          // Sanitize title for filename
          const sanitizedTitle = title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const fileUri = vscode.Uri.joinPath(
            categoryPath,
            `${sanitizedTitle}.md`,
          );

          const metadata: KnowledgeFileMetadata = {
            category,
            title,
            sourceFiles: options?.sourceFiles,
            updatedAt: new Date().toISOString().split("T")[0],
          };

          // Format content with examples if provided
          let markdownContent = content;
          if (options?.examples && options.examples.length > 0) {
            markdownContent += "\n\n## Examples\n\n";
            for (const example of options.examples) {
              markdownContent += `### Example\n\n\`\`\`typescript\n${example}\n\`\`\`\n\n`;
            }
          }

          if (options?.sourceFiles && options.sourceFiles.length > 0) {
            markdownContent += "\n## Source Files\n\n";
            for (const file of options.sourceFiles) {
              markdownContent += `- \`${file}\`\n`;
            }
          }

          const fullContent = `${generateFrontmatter(metadata)}\n${markdownContent}`;

          // Read existing content if appending
          let existingContent = "";
          if (options?.append) {
            const existing = yield* readFileAsStringEffect(fileUri).pipe(
              Effect.map((content) => {
                const parsed = parseFrontmatter(content);
                return parsed.body;
              }),
              Effect.catchAll(() => Effect.succeed("")),
            );
            existingContent = existing;
          }

          const finalContent = options?.append
            ? generateFrontmatter(metadata) +
              "\n" +
              existingContent +
              "\n\n---\n\n" +
              markdownContent
            : fullContent;

          // Write file
          yield* Effect.tryPromise({
            try: async () => {
              await vscode.workspace.fs.writeFile(
                fileUri,
                Buffer.from(finalContent, "utf-8"),
              );
            },
            catch: (error) =>
              new KnowledgeFileError({
                message: `Failed to write knowledge file: ${extractErrorMessage(error)}`,
                cause: error,
              }),
          });

          const _workspaceRoot = yield* getWorkspaceRoot();
          const relativePath = vscode.workspace.asRelativePath(fileUri, false);

          return {
            success: true,
            path: fileUri.fsPath,
            relativePath,
          };
        });

      /**
       * Read a knowledge file
       */
      const readKnowledgeFile = (
        filePath: string,
        options?: { startLine?: number; endLine?: number },
      ) =>
        Effect.gen(function* () {
          const workspaceRoot = yield* getWorkspaceRoot();
          const fileUri = vscode.Uri.joinPath(workspaceRoot, filePath);

          const content = yield* readFileAsStringEffect(fileUri);
          const { frontmatter, body } = parseFrontmatter(content);

          // Extract lines if specified
          let finalBody = body;
          if (
            options?.startLine !== undefined ||
            options?.endLine !== undefined
          ) {
            const lines = body.split("\n");
            const start = options?.startLine ?? 0;
            const end = options?.endLine ?? lines.length;
            finalBody = lines.slice(start, end).join("\n");
          }

          const relativePath = vscode.workspace.asRelativePath(fileUri, false);

          return {
            path: fileUri.fsPath,
            relativePath,
            metadata: {
              category: (frontmatter.category as string) || "unknown",
              title: (frontmatter.title as string) || "",
              sourceFiles: frontmatter.sourceFiles as string[] | undefined,
              updatedAt:
                (frontmatter.updatedAt as string) ||
                new Date().toISOString().split("T")[0],
            } as KnowledgeFileMetadata,
            content: finalBody,
          } satisfies KnowledgeFile;
        });

      /**
       * List all knowledge files
       */
      const listKnowledgeFiles = () =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();
          const _workspaceRoot = yield* getWorkspaceRoot();

          // Find all markdown files in knowledge directory
          const files = yield* findFilesEffect(
            new vscode.RelativePattern(knowledgeDir, "**/*.md"),
          );

          const knowledgeFiles: Array<{
            path: string;
            relativePath: string;
            category?: string;
          }> = [];

          for (const file of files) {
            const relativePath = vscode.workspace.asRelativePath(file, false);
            const result = yield* readFileAsStringEffect(file).pipe(
              Effect.map((content) => {
                const { frontmatter } = parseFrontmatter(content);
                return {
                  path: file.fsPath,
                  relativePath,
                  category: frontmatter.category as string | undefined,
                };
              }),
              Effect.catchAll(() => Effect.succeed(null)),
            );
            if (result) {
              knowledgeFiles.push(result);
            }
          }

          return knowledgeFiles;
        });

      /**
       * Search knowledge files using grep-like pattern matching
       */
      const grepKnowledge = (
        pattern: string,
        options?: { category?: KnowledgeBaseCategory; caseSensitive?: boolean },
      ) =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();
          const _workspaceRoot = yield* getWorkspaceRoot();

          // Find all markdown files
          const files = yield* findFilesEffect(
            new vscode.RelativePattern(knowledgeDir, "**/*.md"),
          );

          const matches: Array<{
            file: string;
            relativePath: string;
            lineNumber: number;
            line: string;
            category?: string;
          }> = [];

          const regex = new RegExp(
            pattern,
            options?.caseSensitive ? "g" : "gi",
          );

          for (const file of files) {
            const result = yield* readFileAsStringEffect(file).pipe(
              Effect.map((content) => {
                const { frontmatter, body } = parseFrontmatter(content);

                // Filter by category if specified
                if (
                  options?.category &&
                  frontmatter.category !== options.category
                ) {
                  return null;
                }

                const lines = body.split("\n");
                const fileMatches: Array<{
                  file: string;
                  relativePath: string;
                  lineNumber: number;
                  line: string;
                  category?: string;
                }> = [];

                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (regex.test(line)) {
                    fileMatches.push({
                      file: file.fsPath,
                      relativePath: vscode.workspace.asRelativePath(
                        file,
                        false,
                      ),
                      lineNumber: i + 1,
                      line: line.trim(),
                      category: frontmatter.category as string | undefined,
                    });
                  }
                }

                return fileMatches;
              }),
              Effect.catchAll(() => Effect.succeed([])),
            );

            if (result && result.length > 0) {
              matches.push(...result);
            }
          }

          return matches;
        });

      /**
       * Generate or update the _index.md file with table of contents
       */
      const generateIndex = () =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();
          const indexUri = vscode.Uri.joinPath(knowledgeDir, "_index.md");
          const workspaceRoot = yield* getWorkspaceRoot();

          // List all knowledge files
          const files = yield* listKnowledgeFiles();

          // Group by category
          const byCategory: Record<
            string,
            Array<{ title: string; path: string }>
          > = {};

          for (const file of files) {
            if (file.relativePath === ".clive/knowledge/_index.md") {
              continue; // Skip index file itself
            }

            yield* readFileAsStringEffect(
              vscode.Uri.joinPath(workspaceRoot, file.relativePath),
            ).pipe(
              Effect.flatMap((content) =>
                Effect.sync(() => {
                  const { frontmatter } = parseFrontmatter(content);
                  const category =
                    (frontmatter.category as string) || "uncategorized";
                  const title =
                    (frontmatter.title as string) || file.relativePath;

                  if (!byCategory[category]) {
                    byCategory[category] = [];
                  }

                  byCategory[category].push({
                    title,
                    path: file.relativePath,
                  });
                }),
              ),
              Effect.catchAll(() => Effect.void),
            );
          }

          // Generate index content with summaries
          let indexContent = `---
title: Knowledge Base Index
updatedAt: ${new Date().toISOString().split("T")[0]}
---

# Knowledge Base Index

This file provides an overview of all knowledge documented for this repository.

`;

          // Extract summaries from article content
          const articlesWithSummaries: Record<
            string,
            Array<{ title: string; path: string; summary: string }>
          > = {};

          // Read all files in parallel to extract summaries
          const allFiles = Object.values(byCategory).flat();
          const fileContentsMap = new Map<string, string>();
          const fileContents = yield* Effect.all(
            allFiles.map((file) =>
              readFileAsStringEffect(
                vscode.Uri.joinPath(workspaceRoot, file.path),
              ).pipe(
                Effect.map((content) => ({ path: file.path, content })),
                Effect.catchAll(() =>
                  Effect.succeed({ path: file.path, content: null }),
                ),
              ),
            ),
            { concurrency: 10 },
          );

          // Build map for quick lookup
          for (const fc of fileContents) {
            if (fc.content) {
              fileContentsMap.set(fc.path, fc.content);
            }
          }

          // Process summaries
          for (const [category, files] of Object.entries(byCategory)) {
            articlesWithSummaries[category] = [];
            for (const file of files) {
              const content = fileContentsMap.get(file.path);
              if (content) {
                const { body } = parseFrontmatter(content);
                // Extract first 1-2 sentences as summary
                const summary = body
                  .split("\n")
                  .filter((line) => line.trim().length > 0)
                  .slice(0, 2)
                  .join(" ")
                  .substring(0, 200)
                  .trim();
                articlesWithSummaries[category].push({
                  ...file,
                  summary: summary || "No summary available",
                });
              } else {
                articlesWithSummaries[category].push({
                  ...file,
                  summary: "Unable to read summary",
                });
              }
            }
          }

          // Sort categories alphabetically
          const sortedCategories = Object.keys(articlesWithSummaries).sort();

          for (const category of sortedCategories) {
            const articles = articlesWithSummaries[category];
            if (articles.length > 0) {
              const categoryDisplay =
                category.charAt(0).toUpperCase() + category.slice(1);
              indexContent += `## ${categoryDisplay}\n\n`;
              for (const article of articles) {
                indexContent += `### [${article.title}](${article.path})\n\n`;
                indexContent += `${article.summary}\n\n`;
              }
              indexContent += "\n";
            }
          }

          // Write index file
          yield* Effect.tryPromise({
            try: async () => {
              await vscode.workspace.fs.writeFile(
                indexUri,
                Buffer.from(indexContent, "utf-8"),
              );
            },
            catch: (error) =>
              new KnowledgeFileError({
                message: `Failed to write index file: ${extractErrorMessage(error)}`,
                cause: error,
              }),
          });

          return { success: true };
        });

      /**
       * Get quality metrics for the knowledge base
       * Returns statistics about articles and content
       */
      const getQualityMetrics = () =>
        Effect.gen(function* () {
          const files = yield* listKnowledgeFiles();
          const workspaceRoot = yield* getWorkspaceRoot();

          // Read all files to calculate word count
          const fileContents = yield* Effect.all(
            files.map((file) =>
              readFileAsStringEffect(
                vscode.Uri.joinPath(workspaceRoot, file.relativePath),
              ).pipe(
                Effect.map((content) => {
                  // Estimate word count: ~5 chars per word
                  const wordCount = Math.floor(content.length / 5);
                  return {
                    path: file.path,
                    wordCount,
                    contentLength: content.length,
                  };
                }),
                Effect.catchAll(() =>
                  Effect.succeed({
                    path: file.path,
                    wordCount: 0,
                    contentLength: 0,
                  }),
                ),
              ),
            ),
            { concurrency: 10 },
          );

          const totalWordCount = fileContents.reduce(
            (sum, file) => sum + file.wordCount,
            0,
          );
          const totalContentLength = fileContents.reduce(
            (sum, file) => sum + file.contentLength,
            0,
          );
          const averageWordCount =
            files.length > 0 ? Math.floor(totalWordCount / files.length) : 0;

          return {
            articleCount: files.length,
            totalWordCount,
            totalContentLength,
            averageWordCount,
          };
        });

      /**
       * Check if knowledge base exists
       */
      const knowledgeBaseExists = () =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();
          const stat = yield* statFileEffect(knowledgeDir).pipe(
            Effect.catchAll(() =>
              Effect.fail(new Error("Directory not found")),
            ),
          );
          return stat.type === vscode.FileType.Directory;
        }).pipe(Effect.catchAll(() => Effect.succeed(false)));

      /**
       * Delete the entire knowledge base directory
       * Used when doing a full regeneration (not resume)
       */
      const deleteKnowledgeBase = () =>
        Effect.gen(function* () {
          const knowledgeDir = yield* getKnowledgeDir();

          // Check if directory exists
          const exists = yield* statFileEffect(knowledgeDir).pipe(
            Effect.map((stat) => stat.type === vscode.FileType.Directory),
            Effect.catchAll(() => Effect.succeed(false)),
          );

          if (!exists) {
            yield* Effect.logDebug(
              "[KnowledgeFileService] Knowledge directory does not exist, nothing to delete",
            );
            return { success: true };
          }

          // Delete the entire directory recursively
          return yield* Effect.tryPromise({
            try: async () => {
              await vscode.workspace.fs.delete(knowledgeDir, {
                recursive: true,
                useTrash: false,
              });
              return { success: true };
            },
            catch: (error) =>
              new KnowledgeFileError({
                message: `Failed to delete knowledge directory: ${extractErrorMessage(error)}`,
                cause: error,
              }),
          });
        });

      return {
        writeKnowledgeFile,
        readKnowledgeFile,
        listKnowledgeFiles,
        grepKnowledge,
        generateIndex,
        getQualityMetrics,
        knowledgeBaseExists,
        getKnowledgeDir,
        deleteKnowledgeBase,
      };
    }),
  },
) {}

/**
 * Production layer - dependencies provided at composition site
 */
export const KnowledgeFileServiceLive = KnowledgeFileService.Default;
