/**
 * Knowledge Context Tracker
 * Manages persistent knowledge entries that survive context summarization
 * Ensures critical knowledge base information (test commands, patterns) is preserved
 */

import { countTokensInText } from "../../utils/token-utils.js";

/**
 * Critical categories that should always be preserved with full content
 */
const CRITICAL_CATEGORIES = [
  "test-execution",
  "test-patterns",
  "infrastructure",
] as const;

/**
 * Maximum tokens allowed for accumulated knowledge context
 * Set to ~8k tokens to balance preservation with context window limits
 */
const MAX_KNOWLEDGE_TOKENS = 8_000;

/**
 * Knowledge entry stored in persistent context
 */
export interface KnowledgeEntry {
  category: string;
  title: string;
  content: string;
  addedAt: number;
  isCritical: boolean;
}

/**
 * Knowledge context manager
 * Tracks knowledge entries and manages size limits
 */
export class KnowledgeContext {
  private entries: KnowledgeEntry[] = [];

  /**
   * Add a knowledge entry to the context
   * Automatically manages size limits and eviction
   */
  addEntry(
    category: string,
    title: string,
    content: string,
  ): { added: boolean; evicted: number } {
    const isCritical = CRITICAL_CATEGORIES.includes(
      category as (typeof CRITICAL_CATEGORIES)[number],
    );

    const entry: KnowledgeEntry = {
      category,
      title,
      content,
      addedAt: Date.now(),
      isCritical,
    };

    // Calculate current size
    const currentSize = this.getTotalTokens();

    // Calculate size after adding this entry
    const entryTokens = countTokensInText(this.formatEntryForTokens(entry));
    const newSize = currentSize + entryTokens;

    // If adding would exceed limit, evict non-critical entries first
    let evicted = 0;
    if (newSize > MAX_KNOWLEDGE_TOKENS) {
      // Remove oldest non-critical entries until we have room
      const nonCriticalEntries = this.entries.filter((e) => !e.isCritical);
      nonCriticalEntries.sort((a, b) => a.addedAt - b.addedAt); // Oldest first

      while (
        newSize - this.getTotalTokens() > MAX_KNOWLEDGE_TOKENS &&
        nonCriticalEntries.length > 0
      ) {
        const toEvict = nonCriticalEntries.shift();
        if (toEvict) {
          const index = this.entries.indexOf(toEvict);
          if (index >= 0) {
            this.entries.splice(index, 1);
            evicted++;
          }
        }
      }

      // If still over limit and this is not critical, don't add it
      const sizeAfterEviction = this.getTotalTokens();
      if (
        sizeAfterEviction + entryTokens > MAX_KNOWLEDGE_TOKENS &&
        !isCritical
      ) {
        return { added: false, evicted };
      }
    }

    // Check if we already have this entry (by category + title)
    const existingIndex = this.entries.findIndex(
      (e) => e.category === category && e.title === title,
    );

    if (existingIndex >= 0) {
      // Update existing entry
      this.entries[existingIndex] = entry;
    } else {
      // Add new entry
      this.entries.push(entry);
    }

    return { added: true, evicted };
  }

  /**
   * Add multiple entries from search results
   */
  addFromSearchResults(
    results: Array<{
      category: string;
      title: string;
      content: string;
      path: string;
    }>,
  ): { added: number; evicted: number } {
    let added = 0;
    let totalEvicted = 0;

    for (const result of results) {
      const { evicted } = this.addEntry(
        result.category,
        result.title,
        result.content,
      );
      if (evicted > 0) {
        totalEvicted += evicted;
      }
      added++;
    }

    return { added, evicted: totalEvicted };
  }

  /**
   * Get all entries formatted for inclusion in prompts
   */
  formatForPrompt(): string {
    if (this.entries.length === 0) {
      return "";
    }

    const sections: string[] = [];
    sections.push(
      "## Persistent Knowledge Context (Preserved Across Summarization)",
    );
    sections.push("");

    // Group by category
    const byCategory = new Map<string, KnowledgeEntry[]>();
    for (const entry of this.entries) {
      if (!byCategory.has(entry.category)) {
        byCategory.set(entry.category, []);
      }
      byCategory.get(entry.category)?.push(entry);
    }

    // Sort categories: critical first, then alphabetically
    const sortedCategories = Array.from(byCategory.keys()).sort((a, b) => {
      const aCritical = CRITICAL_CATEGORIES.includes(
        a as (typeof CRITICAL_CATEGORIES)[number],
      );
      const bCritical = CRITICAL_CATEGORIES.includes(
        b as (typeof CRITICAL_CATEGORIES)[number],
      );
      if (aCritical && !bCritical) return -1;
      if (!aCritical && bCritical) return 1;
      return a.localeCompare(b);
    });

    for (const category of sortedCategories) {
      const entries = byCategory.get(category);
      if (!entries) continue;

      sections.push(`### ${category}`);
      sections.push("");

      for (const entry of entries) {
        sections.push(`**${entry.title}**`);
        sections.push(entry.content);
        sections.push("");
      }
    }

    return sections.join("\n");
  }

  /**
   * Get total token count of all entries
   */
  getTotalTokens(): number {
    return this.entries.reduce(
      (total, entry) =>
        total + countTokensInText(this.formatEntryForTokens(entry)),
      0,
    );
  }

  /**
   * Get number of entries
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Format an entry for token counting
   */
  private formatEntryForTokens(entry: KnowledgeEntry): string {
    return `### ${entry.category}\n**${entry.title}**\n${entry.content}`;
  }
}
