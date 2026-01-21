/**
 * SubagentTracker
 * Tracks Task tool lifecycle (spawn and completion of subagents)
 * Provides special output events for subagent tracing in the UI
 */

import { OutputLine } from '../types';

export interface SubagentInfo {
  id: string;
  type: string;
  description: string;
  spawnedAt: Date;
}

export class SubagentTracker {
  // Track active subagents by tool use ID
  private activeSubagents = new Map<string, SubagentInfo>();

  /**
   * Handle tool_use event - detect Task tool spawns
   * Returns OutputLine for subagent_spawn event or null
   */
  handleToolUse(toolUseId: string, toolName: string, input: any): OutputLine | null {
    if (toolName !== 'Task') {
      return null;
    }

    // Extract subagent info from Task tool input
    const subagentType = input.subagent_type || input.agent_type || 'unknown';
    const description = input.description || input.prompt || 'No description';

    // Store subagent info
    const info: SubagentInfo = {
      id: toolUseId,
      type: subagentType,
      description,
      spawnedAt: new Date(),
    };
    this.activeSubagents.set(toolUseId, info);

    // Return spawn event
    return {
      text: `Spawning ${subagentType} agent: ${description}`,
      type: 'subagent_spawn',
      toolName: 'Task',
      toolUseID: toolUseId,
      startTime: new Date(),
    };
  }

  /**
   * Handle tool_result event - detect Task tool completions
   * Returns OutputLine for subagent_complete event or null
   */
  handleToolResult(toolUseId: string, toolName: string, result: string): OutputLine | null {
    if (toolName !== 'Task') {
      return null;
    }

    const info = this.activeSubagents.get(toolUseId);
    if (!info) {
      // No spawn info found, might be a resumed agent
      return {
        text: 'Subagent completed',
        type: 'subagent_complete',
        toolName: 'Task',
        toolUseID: toolUseId,
      };
    }

    // Calculate duration
    const duration = Date.now() - info.spawnedAt.getTime();

    // Remove from active list
    this.activeSubagents.delete(toolUseId);

    // Return completion event
    return {
      text: `${info.type} agent completed (${this.formatDuration(duration)})`,
      type: 'subagent_complete',
      toolName: 'Task',
      toolUseID: toolUseId,
      duration,
    };
  }

  /**
   * Get currently active subagents
   */
  getActiveSubagents(): SubagentInfo[] {
    return Array.from(this.activeSubagents.values());
  }

  /**
   * Clear all tracked subagents
   */
  clear(): void {
    this.activeSubagents.clear();
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
}
