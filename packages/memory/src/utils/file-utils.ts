/**
 * @clive/memory - File utilities
 *
 * Helper functions for file operations and markdown formatting.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect } from "effect";
import { CategoryTemplates, MemoryPaths } from "../constants.js";
import type { MemoryEntry, MemorySource } from "../types.js";

/**
 * Error for file operations
 */
export class FileError extends Error {
  readonly _tag = "FileError";
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FileError";
  }
}

/**
 * Calculate SHA-256 hash of content
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Get today's date in YYYY-MM-DD format
 */
export function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Get the path to today's daily log file
 */
export function getDailyLogPath(workspaceRoot: string): string {
  const date = getTodayDate();
  return path.join(workspaceRoot, MemoryPaths.daily, `${date}.md`);
}

/**
 * Get the absolute path for a memory file
 */
export function getMemoryFilePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  return path.join(workspaceRoot, MemoryPaths.base, relativePath);
}

/**
 * Get the relative path from an absolute path
 */
export function getRelativePath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const basePath = path.join(workspaceRoot, MemoryPaths.base);
  return path.relative(basePath, absolutePath);
}

/**
 * Determine the source type from a file path
 */
export function getSourceFromPath(relativePath: string): MemorySource {
  if (relativePath.startsWith("daily/")) {
    return "sessions";
  }
  return "memory";
}

/**
 * Ensure a directory exists
 */
export const ensureDir = (dirPath: string) =>
  Effect.tryPromise({
    try: () => fs.mkdir(dirPath, { recursive: true }),
    catch: (error) => new FileError(`Failed to create directory: ${dirPath}`, error),
  });

/**
 * Check if a file exists
 */
export const fileExists = (filePath: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
    catch: (error) => new FileError(`Failed to check file: ${filePath}`, error),
  });

/**
 * Read a file's content
 */
export const readFile = (filePath: string) =>
  Effect.tryPromise({
    try: () => fs.readFile(filePath, "utf8"),
    catch: (error) => new FileError(`Failed to read file: ${filePath}`, error),
  });

/**
 * Write content to a file
 */
export const writeFile = (filePath: string, content: string) =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    },
    catch: (error) => new FileError(`Failed to write file: ${filePath}`, error),
  });

/**
 * Append content to a file
 */
export const appendFile = (filePath: string, content: string) =>
  Effect.tryPromise({
    try: async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, content, "utf8");
    },
    catch: (error) => new FileError(`Failed to append to file: ${filePath}`, error),
  });

/**
 * Get file stats
 */
export const getFileStats = (filePath: string) =>
  Effect.tryPromise({
    try: () => fs.stat(filePath),
    catch: (error) => new FileError(`Failed to get file stats: ${filePath}`, error),
  });

/**
 * List files in a directory matching a pattern
 */
export const listFiles = (dirPath: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        return entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => path.join(dirPath, entry.name));
      } catch {
        return [];
      }
    },
    catch: (error) => new FileError(`Failed to list files: ${dirPath}`, error),
  });

/**
 * Format a memory entry for the daily log
 */
export function formatMemoryEntry(entry: MemoryEntry): string {
  const template = CategoryTemplates[entry.category];
  const timestamp = new Date().toISOString();
  const tags = entry.tags?.length ? `\n*Tags: ${entry.tags.join(", ")}*\n` : "";

  return `\n${template}*${timestamp}*${tags}\n${entry.content}\n\n---\n`;
}

/**
 * Format the daily log header
 */
export function formatDailyLogHeader(): string {
  const date = getTodayDate();
  return `# Daily Log - ${date}\n\n`;
}

/**
 * Read specific lines from a file
 */
export const readFileLines = (
  filePath: string,
  from: number,
  count?: number,
) =>
  Effect.gen(function* () {
    const content = yield* readFile(filePath);
    const lines = content.split("\n");
    const totalLines = lines.length;

    // Adjust for 1-based indexing
    const startIndex = Math.max(0, from - 1);
    const endIndex = count ? Math.min(startIndex + count, totalLines) : totalLines;

    const selectedLines = lines.slice(startIndex, endIndex);

    return {
      content: selectedLines.join("\n"),
      totalLines,
      startLine: startIndex + 1,
      endLine: Math.min(endIndex, totalLines),
    };
  });

/**
 * Truncate a string to a maximum length, preserving word boundaries
 */
export function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  // Find the last space before maxLength
  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");

  if (lastSpace > maxLength * 0.8) {
    return `${truncated.substring(0, lastSpace)}...`;
  }

  return `${truncated}...`;
}
