/**
 * DiffDetector
 * Detects file modifications and generates diffs for display
 * Monitors Edit/Write tool operations and compares file states
 */

import * as fs from 'fs';
import * as path from 'path';

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber?: number;
}

export class DiffDetector {
  // Store file snapshots before modifications
  private fileSnapshots = new Map<string, string>();

  /**
   * Called when a tool_use event occurs for Edit or Write
   * Captures file state before modification
   */
  handleToolUse(toolName: string, input: any): void {
    if (toolName !== 'Edit' && toolName !== 'Write') {
      return;
    }

    const filePath = input.file_path;
    if (!filePath) {
      return;
    }

    // Store old content before the edit happens
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        this.fileSnapshots.set(filePath, content);
      } catch (error) {
        // File might not be readable, store empty
        this.fileSnapshots.set(filePath, '');
      }
    } else {
      // New file will be created
      this.fileSnapshots.set(filePath, '');
    }
  }

  /**
   * Generate diff for a file after modification
   * Returns formatted diff string or null if not a file operation
   */
  generateDiff(toolName: string, input: any): string | null {
    if (toolName !== 'Edit' && toolName !== 'Write') {
      return null;
    }

    const filePath = input.file_path;
    if (!filePath) {
      return null;
    }

    const oldContent = this.fileSnapshots.get(filePath) || '';

    // Read new content
    let newContent = '';
    if (fs.existsSync(filePath)) {
      try {
        newContent = fs.readFileSync(filePath, 'utf-8');
      } catch (error) {
        return `Error reading file: ${error}`;
      }
    }

    // Clear snapshot
    this.fileSnapshots.delete(filePath);

    // Generate diff
    return this.formatDiff(filePath, oldContent, newContent, toolName);
  }

  /**
   * Format diff for display (simplified line-based diff)
   * Ports logic from apps/tui-go/internal/process/diff.go
   */
  private formatDiff(
    filePath: string,
    oldContent: string,
    newContent: string,
    operation: string
  ): string {
    const fileName = path.basename(filePath);
    const lines: string[] = [];

    // Header
    const emoji = operation === 'Write' && !oldContent ? '●' : '●';
    const action = operation === 'Write' && !oldContent ? 'Create' : 'Update';
    lines.push(`${emoji} ${action}(${fileName})`);

    // For new files, show first few lines
    if (!oldContent && newContent) {
      const newLines = newContent.split('\n').slice(0, 20);
      newLines.forEach(line => {
        lines.push(`  + ${line}`);
      });
      if (newContent.split('\n').length > 20) {
        lines.push(`  ... (${newContent.split('\n').length - 20} more lines)`);
      }
      return lines.join('\n');
    }

    // For edits, show changed sections
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    // Simple line-based diff (not perfect, but good enough)
    const diff = this.simpleDiff(oldLines, newLines);

    let changeCount = 0;
    const maxChanges = 50; // Limit displayed changes

    for (const item of diff) {
      if (changeCount >= maxChanges) {
        lines.push(`  ... (${diff.length - changeCount} more changes)`);
        break;
      }

      if (item.type === 'remove') {
        lines.push(`  - ${item.content}`);
        changeCount++;
      } else if (item.type === 'add') {
        lines.push(`  + ${item.content}`);
        changeCount++;
      } else if (item.type === 'context') {
        // Show limited context
        if (changeCount === 0 || changeCount > maxChanges - 3) {
          lines.push(`    ${item.content}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Simple line-based diff algorithm
   * Returns array of diff operations
   */
  private simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
    const result: DiffLine[] = [];

    // Create lookup for fast comparison
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);

    let oldIdx = 0;
    let newIdx = 0;

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
      const oldLine = oldLines[oldIdx];
      const newLine = newLines[newIdx];

      if (oldIdx >= oldLines.length) {
        // Remaining lines are additions
        result.push({ type: 'add', content: newLine });
        newIdx++;
      } else if (newIdx >= newLines.length) {
        // Remaining lines are deletions
        result.push({ type: 'remove', content: oldLine });
        oldIdx++;
      } else if (oldLine === newLine) {
        // Lines match
        result.push({ type: 'context', content: oldLine });
        oldIdx++;
        newIdx++;
      } else {
        // Lines differ - check if one was removed or added
        if (!newSet.has(oldLine)) {
          // Old line was removed
          result.push({ type: 'remove', content: oldLine });
          oldIdx++;
        } else if (!oldSet.has(newLine)) {
          // New line was added
          result.push({ type: 'add', content: newLine });
          newIdx++;
        } else {
          // Both exist somewhere, treat as changed
          result.push({ type: 'remove', content: oldLine });
          result.push({ type: 'add', content: newLine });
          oldIdx++;
          newIdx++;
        }
      }
    }

    return result;
  }

  /**
   * Clear all snapshots (useful when starting new session)
   */
  clear(): void {
    this.fileSnapshots.clear();
  }
}
