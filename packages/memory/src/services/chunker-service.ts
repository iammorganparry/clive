/**
 * @clive/memory - Chunker Service
 *
 * Effect-TS service for splitting markdown content into chunks.
 * Respects markdown headers as chunk boundaries and tracks line numbers.
 */

import * as crypto from "node:crypto";
import { encodingForModel } from "js-tiktoken";
import { Data, Effect } from "effect";
import { IndexingDefaults } from "../constants.js";
import type { MemoryChunk, MemorySource } from "../types.js";

/**
 * Error when chunking fails
 */
export class ChunkerError extends Data.TaggedError("ChunkerError")<{
  message: string;
  cause?: unknown;
}> {}

/**
 * Configuration for chunking
 */
export interface ChunkerConfig {
  /** Target chunk size in tokens (default: 400) */
  chunkSize: number;
  /** Overlap between chunks in tokens (default: 80) */
  chunkOverlap: number;
}

/**
 * Internal representation of a text segment
 */
interface TextSegment {
  content: string;
  startLine: number;
  endLine: number;
  isHeader: boolean;
  headerLevel: number;
}

/**
 * Get the tiktoken encoder for gpt-4
 * We use gpt-4 tokenizer as it's closest to Claude's tokenization
 */
function getEncoder() {
  return encodingForModel("gpt-4");
}

/**
 * Count tokens in a string
 */
function countTokens(text: string, encoder: ReturnType<typeof getEncoder>): number {
  return encoder.encode(text).length;
}

/**
 * Generate a unique ID for a chunk
 */
function generateChunkId(filePath: string, chunkIndex: number, content: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${filePath}:${chunkIndex}:${content.substring(0, 100)}`)
    .digest("hex")
    .substring(0, 16);
  return `chunk_${hash}`;
}

/**
 * Generate content hash for a chunk
 */
function generateContentHash(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * Parse markdown content into segments
 */
function parseIntoSegments(content: string): TextSegment[] {
  const lines = content.split("\n");
  const segments: TextSegment[] = [];
  let currentSegment: TextSegment | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line?.match(/^(#{1,6})\s+/);

    if (headerMatch) {
      // Save current segment if exists
      if (currentSegment?.content.trim()) {
        segments.push(currentSegment);
      }

      // Start new segment with header
      currentSegment = {
        content: line || "",
        startLine: i + 1,
        endLine: i + 1,
        isHeader: true,
        headerLevel: headerMatch[1]?.length || 1,
      };
    } else {
      if (!currentSegment) {
        // Start first segment without header
        currentSegment = {
          content: line || "",
          startLine: i + 1,
          endLine: i + 1,
          isHeader: false,
          headerLevel: 0,
        };
      } else {
        // Add line to current segment
        currentSegment.content += `\n${line}`;
        currentSegment.endLine = i + 1;
      }
    }
  }

  // Add final segment
  if (currentSegment?.content.trim()) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Merge small segments that are below the chunk size
 */
function mergeSmallSegments(
  segments: TextSegment[],
  chunkSize: number,
  encoder: ReturnType<typeof getEncoder>,
): TextSegment[] {
  const merged: TextSegment[] = [];
  let current: TextSegment | null = null;

  for (const segment of segments) {
    if (!current) {
      current = { ...segment };
      continue;
    }

    const combinedTokens = countTokens(
      `${current.content}\n${segment.content}`,
      encoder,
    );

    // If combining doesn't exceed chunk size, merge
    // But don't merge across major headers (h1, h2)
    if (
      combinedTokens <= chunkSize &&
      !(segment.isHeader && segment.headerLevel <= 2)
    ) {
      current.content = `${current.content}\n${segment.content}`;
      current.endLine = segment.endLine;
    } else {
      // Save current and start new
      if (current.content.trim()) {
        merged.push(current);
      }
      current = { ...segment };
    }
  }

  // Add final segment
  if (current?.content.trim()) {
    merged.push(current);
  }

  return merged;
}

/**
 * Split a large segment into smaller chunks with overlap
 */
function splitLargeSegment(
  segment: TextSegment,
  chunkSize: number,
  chunkOverlap: number,
  encoder: ReturnType<typeof getEncoder>,
): TextSegment[] {
  const segmentTokens = countTokens(segment.content, encoder);

  if (segmentTokens <= chunkSize) {
    return [segment];
  }

  const chunks: TextSegment[] = [];
  const lines = segment.content.split("\n");
  let currentContent = "";
  let currentStartLine = segment.startLine;
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const testContent = currentContent ? `${currentContent}\n${line}` : line || "";
    const testTokens = countTokens(testContent, encoder);

    if (testTokens <= chunkSize) {
      currentContent = testContent;
      lineIndex++;
    } else {
      // Save current chunk if we have content
      if (currentContent.trim()) {
        chunks.push({
          content: currentContent,
          startLine: currentStartLine,
          endLine: segment.startLine + lineIndex - 1,
          isHeader: segment.isHeader && chunks.length === 0,
          headerLevel: segment.headerLevel,
        });

        // Calculate overlap - go back by overlap tokens
        const overlapLines: string[] = [];
        let overlapTokens = 0;
        let overlapIndex = lineIndex - 1;

        while (
          overlapIndex >= 0 &&
          overlapTokens < chunkOverlap &&
          overlapIndex >= chunks.length
        ) {
          const overlapLine = lines[overlapIndex];
          if (overlapLine !== undefined) {
            const lineTokens = countTokens(overlapLine, encoder);
            if (overlapTokens + lineTokens <= chunkOverlap) {
              overlapLines.unshift(overlapLine);
              overlapTokens += lineTokens;
            } else {
              break;
            }
          }
          overlapIndex--;
        }

        currentContent = overlapLines.join("\n");
        currentStartLine = segment.startLine + Math.max(0, overlapIndex + 1);
      } else {
        // Single line exceeds chunk size - just include it
        currentContent = line || "";
        lineIndex++;
      }
    }
  }

  // Add final chunk
  if (currentContent.trim()) {
    chunks.push({
      content: currentContent,
      startLine: currentStartLine,
      endLine: segment.endLine,
      isHeader: false,
      headerLevel: 0,
    });
  }

  return chunks;
}

/**
 * Chunker Service implementation
 */
export class ChunkerService extends Effect.Service<ChunkerService>()(
  "ChunkerService",
  {
    effect: Effect.gen(function* () {
      const encoder = getEncoder();

      /**
       * Chunk a markdown file into memory chunks
       */
      const chunkFile = (
        filePath: string,
        content: string,
        source: MemorySource,
        config?: Partial<ChunkerConfig>,
      ) =>
        Effect.gen(function* () {
          const chunkSize = config?.chunkSize ?? IndexingDefaults.chunkSize;
          const chunkOverlap = config?.chunkOverlap ?? IndexingDefaults.chunkOverlap;

          yield* Effect.logDebug(
            `[ChunkerService] Chunking file: ${filePath} (${content.length} chars)`,
          );

          // Parse content into segments based on headers
          const segments = parseIntoSegments(content);

          // Merge small segments
          const mergedSegments = mergeSmallSegments(segments, chunkSize, encoder);

          // Split large segments with overlap
          const finalSegments: TextSegment[] = [];
          for (const segment of mergedSegments) {
            const split = splitLargeSegment(
              segment,
              chunkSize,
              chunkOverlap,
              encoder,
            );
            finalSegments.push(...split);
          }

          // Convert to MemoryChunks
          const chunks: MemoryChunk[] = finalSegments.map((segment, index) => ({
            id: generateChunkId(filePath, index, segment.content),
            filePath,
            source,
            chunkIndex: index,
            startLine: segment.startLine,
            endLine: segment.endLine,
            content: segment.content,
            contentHash: generateContentHash(segment.content),
            embedding: null,
            model: null,
            createdAt: new Date(),
          }));

          yield* Effect.logDebug(
            `[ChunkerService] Created ${chunks.length} chunks for ${filePath}`,
          );

          return chunks;
        });

      /**
       * Count tokens in text
       */
      const getTokenCount = (text: string) =>
        Effect.sync(() => countTokens(text, encoder));

      return {
        chunkFile,
        getTokenCount,
      };
    }),
  },
) {}

/**
 * Live layer for ChunkerService
 */
export const ChunkerServiceLive = ChunkerService.Default;
