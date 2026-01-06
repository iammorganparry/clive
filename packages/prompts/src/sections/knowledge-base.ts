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
- Search for relevant articles by topic
- Read specific articles as needed

When you discover something valuable not in the knowledge base, consider documenting it
for future reference. Choose a category name that makes sense for the discovery.
</knowledge_base>`,
  );
