/**
 * searchKnowledge MCP Tool
 * Searches the .clive/knowledge/ directory for relevant information
 * This is a standalone tool that doesn't need the VSCode extension bridge
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { glob } from "glob";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Input schema for searchKnowledge
 */
const SearchKnowledgeInputSchema = z.object({
  query: z
    .string()
    .describe(
      "What you want to find (e.g., 'authentication flow', 'API endpoints', 'component patterns')",
    ),
  limit: z
    .number()
    .optional()
    .default(5)
    .describe("Maximum number of results to return (default: 5)"),
});

/**
 * Critical categories that should return full content
 */
const CRITICAL_CATEGORIES = [
  "test-execution",
  "test-patterns",
  "infrastructure",
];

/**
 * Knowledge article metadata
 */
interface KnowledgeMetadata {
  category: string;
  title: string;
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseMarkdownFrontmatter(content: string): {
  metadata: KnowledgeMetadata;
  body: string;
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      metadata: { category: "unknown", title: "Untitled" },
      body: content,
    };
  }

  const [, frontmatter, body] = frontmatterMatch;
  const metadata: KnowledgeMetadata = {
    category: "unknown",
    title: "Untitled",
  };

  // Simple YAML parsing for category and title
  const categoryMatch = frontmatter.match(/^category:\s*(.+)$/m);
  const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);

  if (categoryMatch) {
    metadata.category = categoryMatch[1].trim().replace(/^["']|["']$/g, "");
  }
  if (titleMatch) {
    metadata.title = titleMatch[1].trim().replace(/^["']|["']$/g, "");
  }

  return { metadata, body };
}

/**
 * Register the searchKnowledge tool with the MCP server
 */
export function registerSearchKnowledge(server: McpServer): void {
  server.tool(
    "searchKnowledge",
    "Search the knowledge base for relevant information about this codebase using text matching. Use this to find articles about architecture, user journeys, components, integrations, testing patterns, or any other documented knowledge.",
    SearchKnowledgeInputSchema.shape,
    async (input: z.infer<typeof SearchKnowledgeInputSchema>) => {
      const { query, limit = 5 } = input;
      const workspaceRoot = process.env.CLIVE_WORKSPACE;
      if (!workspaceRoot) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                results: [],
                query,
                count: 0,
                error: "Workspace root not set",
              }),
            },
          ],
        };
      }

      const knowledgeDir = path.join(workspaceRoot, ".clive", "knowledge");

      try {
        // Check if knowledge directory exists
        await fs.access(knowledgeDir);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                results: [],
                query,
                count: 0,
                message: "Knowledge directory does not exist",
              }),
            },
          ],
        };
      }

      try {
        // Find all markdown files
        const files = await glob("**/*.md", { cwd: knowledgeDir });

        if (files.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  results: [],
                  query,
                  count: 0,
                  message: "No knowledge files found",
                }),
              },
            ],
          };
        }

        // Read and score all files
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/);

        const scoredItems: Array<{
          category: string;
          title: string;
          content: string;
          path: string;
          score: number;
        }> = [];

        for (const file of files) {
          const filePath = path.join(knowledgeDir, file);
          const content = await fs.readFile(filePath, "utf-8");
          const { metadata, body } = parseMarkdownFrontmatter(content);

          const searchableText =
            `${metadata.category} ${metadata.title} ${body}`.toLowerCase();

          // Score based on term matches
          let score = 0;
          for (const term of queryTerms) {
            if (searchableText.includes(term)) {
              score += 1;
            }
          }

          // Boost if category or title matches
          if (metadata.category.toLowerCase().includes(queryLower)) {
            score += 2;
          }
          if (metadata.title.toLowerCase().includes(queryLower)) {
            score += 2;
          }

          if (score > 0) {
            scoredItems.push({
              category: metadata.category,
              title: metadata.title,
              content: body,
              path: file,
              score,
            });
          }
        }

        // Sort by score and limit
        scoredItems.sort((a, b) => b.score - a.score);
        const topResults = scoredItems.slice(0, limit);

        // Format results, truncating non-critical categories
        const results = topResults.map((item) => {
          const isCritical = CRITICAL_CATEGORIES.includes(item.category);
          return {
            category: item.category,
            title: item.title,
            content: isCritical ? item.content : item.content.substring(0, 500),
            path: item.path,
            similarity: item.score / (queryTerms.length + 4),
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                results,
                query,
                count: results.length,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                results: [],
                query,
                count: 0,
                error: error instanceof Error ? error.message : "Search failed",
              }),
            },
          ],
        };
      }
    },
  );
}
