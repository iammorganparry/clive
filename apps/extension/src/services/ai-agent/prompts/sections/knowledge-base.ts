/**
 * Knowledge Base Section
 * Instructions for using the knowledge base at .clive/knowledge/
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const knowledgeBase: Section = (_config) =>
  Effect.succeed(
    `<knowledge_base>
A knowledge base may exist at .clive/knowledge/ containing deep understanding of this codebase - 
architecture, user journeys, components, integrations, testing patterns, and more. The structure 
varies by project.

You can:
- Read _index.md to see what knowledge exists
- Use searchKnowledge to find relevant articles by meaning
- Read specific articles with bashExecute

When you discover something valuable not in the knowledge base, use writeKnowledgeFile 
to record it. Choose a category name that makes sense for the discovery.
</knowledge_base>`,
  );
