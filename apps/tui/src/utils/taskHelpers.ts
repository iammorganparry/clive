/**
 * Task helper utilities for normalizing task data across different sources
 */

import type { Task } from '../types';

/**
 * Normalized task status for UI rendering
 */
export type NormalizedStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * Extract normalized status from a task (BeadsIssue or LinearIssue)
 *
 * BeadsIssue has status property directly: "open" | "in_progress" | "closed" | "blocked"
 * LinearIssue has state.type: "backlog" | "unstarted" | "started" | "completed" | "canceled"
 *
 * @param task - The task to extract status from
 * @returns Normalized status for UI rendering
 */
export function getTaskStatus(task: Task): NormalizedStatus {
  // BeadsIssue has status property directly
  if ('status' in task && task.status) {
    // Map Beads statuses to normalized status
    switch (task.status) {
      case 'open':
        return 'pending';
      case 'in_progress':
        return 'in_progress';
      case 'closed':
        return 'completed';
      case 'blocked':
        return 'blocked';
      default:
        return 'pending';
    }
  }

  // LinearIssue has state.type
  if ('state' in task && task.state) {
    switch (task.state.type) {
      case 'backlog':
      case 'unstarted':
        return 'pending';
      case 'started':
        return 'in_progress';
      case 'completed':
        return 'completed';
      case 'canceled':
        return 'blocked';
      default:
        return 'pending';
    }
  }

  // Default fallback
  return 'pending';
}
