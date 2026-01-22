/**
 * ConversationService
 * Fetches and manages Claude CLI conversation history
 * Reads from ~/.claude/history.jsonl and ~/.claude/projects/
 */

import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';

export interface Conversation {
  sessionId: string;
  project: string;
  display: string; // First user message
  timestamp: number;
  slug?: string; // Human-readable name from conversation file
  gitBranch?: string;
}

export class ConversationService {
  private readonly claudeDir: string;
  private readonly historyFile: string;
  private readonly projectsDir: string;

  constructor() {
    this.claudeDir = path.join(os.homedir(), '.claude');
    this.historyFile = path.join(this.claudeDir, 'history.jsonl');
    this.projectsDir = path.join(this.claudeDir, 'projects');
  }

  /**
   * Get recent conversations grouped by session
   * Returns most recent conversations first
   */
  async getRecentConversations(limit: number = 50): Promise<Conversation[]> {
    if (!existsSync(this.historyFile)) {
      return [];
    }

    const historyContent = await readFile(this.historyFile, 'utf-8');
    const lines = historyContent.trim().split('\n');

    // Parse history entries
    const historyEntries: Array<{
      sessionId: string;
      project: string;
      display: string;
      timestamp: number;
    }> = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId && entry.project && entry.display && entry.timestamp) {
          historyEntries.push({
            sessionId: entry.sessionId,
            project: entry.project,
            display: entry.display,
            timestamp: entry.timestamp,
          });
        }
      } catch (error) {
        // Skip invalid lines
        continue;
      }
    }

    // Group by sessionId and take the first entry (original prompt) for each session
    const sessionMap = new Map<string, Conversation>();

    // Process in reverse order (newest first)
    for (let i = historyEntries.length - 1; i >= 0; i--) {
      const entry = historyEntries[i];

      // Only keep the first (earliest) entry for each session
      // which represents the initial prompt
      if (!sessionMap.has(entry.sessionId)) {
        sessionMap.set(entry.sessionId, {
          sessionId: entry.sessionId,
          project: entry.project,
          display: entry.display,
          timestamp: entry.timestamp,
        });
      }
    }

    // Convert to array and sort by timestamp (newest first)
    const conversations = Array.from(sessionMap.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);

    // Enrich with slug and git branch from conversation files
    await this.enrichConversations(conversations);

    return conversations;
  }

  /**
   * Get conversations for a specific project/directory
   */
  async getConversationsForProject(projectPath: string, limit: number = 50): Promise<Conversation[]> {
    const allConversations = await this.getRecentConversations(200); // Get more to filter

    return allConversations
      .filter(conv => conv.project === projectPath)
      .slice(0, limit);
  }

  /**
   * Enrich conversations with slug and git branch from conversation files
   */
  private async enrichConversations(conversations: Conversation[]): Promise<void> {
    for (const conv of conversations) {
      try {
        // Encode project path for directory name (same as CLI does)
        const encodedProject = this.encodeProjectPath(conv.project);
        const projectDir = path.join(this.projectsDir, encodedProject);
        const conversationFile = path.join(projectDir, `${conv.sessionId}.jsonl`);

        if (existsSync(conversationFile)) {
          // Read first line to get slug and git branch
          const content = await readFile(conversationFile, 'utf-8');
          const firstLine = content.split('\n')[0];

          if (firstLine) {
            const data = JSON.parse(firstLine);
            conv.slug = data.slug;
            conv.gitBranch = data.gitBranch;
          }
        }
      } catch (error) {
        // Skip enrichment on error
        continue;
      }
    }
  }

  /**
   * Encode project path for directory name
   * Mimics the CLI's encoding: replace / with - and remove : (for Windows)
   */
  private encodeProjectPath(projectPath: string): string {
    return projectPath
      .replace(/\//g, '-')
      .replace(/:/g, '');
  }

  /**
   * Get conversation details (full transcript)
   */
  async getConversationDetails(sessionId: string, projectPath: string): Promise<any[]> {
    const encodedProject = this.encodeProjectPath(projectPath);
    const projectDir = path.join(this.projectsDir, encodedProject);
    const conversationFile = path.join(projectDir, `${sessionId}.jsonl`);

    if (!existsSync(conversationFile)) {
      return [];
    }

    const content = await readFile(conversationFile, 'utf-8');
    const lines = content.trim().split('\n');

    const events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        continue;
      }
    }

    return events;
  }

  /**
   * Check if a conversation exists
   */
  async conversationExists(sessionId: string, projectPath: string): Promise<boolean> {
    const encodedProject = this.encodeProjectPath(projectPath);
    const projectDir = path.join(this.projectsDir, encodedProject);
    const conversationFile = path.join(projectDir, `${sessionId}.jsonl`);

    return existsSync(conversationFile);
  }
}
