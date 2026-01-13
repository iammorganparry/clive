import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { Task } from '../types.js';

// Beads epic structure (P0 priority issues that represent work plans)
export interface BeadsEpic {
  id: string;
  title: string;
  status: string;
  priority: number;
  labels: string[];
  parent?: string;
  createdAt?: string;
  updatedAt?: string;
}

// Raw beads issue from JSON output
interface BeadsIssue {
  id: string;
  title: string;
  status: string;
  priority: number;
  labels?: string[];
  parent?: string;
  created_at?: string;
  updated_at?: string;
}

export function isBeadsAvailable(): boolean {
  try {
    execSync('which bd', { stdio: 'ignore' });
    return fs.existsSync('.beads');
  } catch {
    return false;
  }
}

// Get all work plan epics (P0 priority issues with "[branch] Work Plan" title pattern)
export function getEpics(): BeadsEpic[] {
  if (!isBeadsAvailable()) return [];

  try {
    const result = spawnSync('bd', ['list', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) return [];

    const issues: BeadsIssue[] = JSON.parse(result.stdout || '[]');

    // Filter to P0 epics (work plans) - they have no parent and priority 0
    // Title pattern: "[branch] Work Plan - YYYY-MM-DD" or similar
    return issues
      .filter(issue =>
        issue.priority === 0 &&
        !issue.parent &&
        (issue.title.includes('Work Plan') || issue.title.includes('work plan'))
      )
      .map(issue => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        labels: issue.labels || [],
        parent: issue.parent,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
      }));
  } catch {
    return [];
  }
}

// Get all tasks under a specific epic
export function getEpicTasks(epicId: string): Task[] {
  if (!isBeadsAvailable()) return [];

  try {
    const result = spawnSync('bd', ['list', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) return [];

    const issues: BeadsIssue[] = JSON.parse(result.stdout || '[]');

    // Filter to tasks that have this epic as parent
    return issues
      .filter(issue => issue.parent === epicId)
      .map(issue => ({
        id: issue.id,
        title: issue.title.replace(/^Task:\s*/i, ''), // Clean up "Task: " prefix
        status: mapBeadsStatus(issue.status),
        tier: extractTier(issue.priority, issue.labels),
        skill: extractSkillFromLabels(issue.labels),
        category: extractCategoryFromLabels(issue.labels),
      }));
  } catch {
    return [];
  }
}

// Extract branch name from epic title
// Pattern: "[feature-auth] Work Plan - 2024-01-15" -> "feature-auth"
export function extractBranchFromTitle(title: string): string | undefined {
  const match = title.match(/^\[([^\]]+)\]/);
  return match?.[1];
}

// Format epic title to a human-readable session name
// "[feature-auth] Work Plan - 2024-01-15" -> "Feature Auth"
export function formatEpicName(title: string): string {
  const branch = extractBranchFromTitle(title);
  if (!branch) {
    // Fallback: use title without date
    return title.replace(/\s*-\s*\d{4}-\d{2}-\d{2}$/, '').replace('Work Plan', '').trim();
  }
  // Convert kebab-case to Title Case
  return branch
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// Check if an epic has any in-progress tasks
export function hasInProgressTasks(epicId: string): boolean {
  const tasks = getEpicTasks(epicId);
  return tasks.some(t => t.status === 'in_progress');
}

function extractCategoryFromLabels(labels: string[] | undefined): string | undefined {
  if (!labels) return undefined;
  const categoryLabel = labels.find(l => l.startsWith('category:'));
  return categoryLabel?.replace('category:', '');
}

export function getReadyTasks(): Task[] {
  if (!isBeadsAvailable()) return [];

  try {
    const result = spawnSync('bd', ['ready', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) return [];

    const tasks = JSON.parse(result.stdout || '[]');
    return tasks.map((t: Record<string, unknown>) => ({
      id: t.id as string,
      title: t.title as string,
      status: 'pending' as const,
      skill: extractSkillFromLabels(t.labels as string[] | undefined),
    }));
  } catch {
    return [];
  }
}

export function getAllTasks(): Task[] {
  if (!isBeadsAvailable()) return [];

  try {
    const result = spawnSync('bd', ['list', '--json'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status !== 0) return [];

    const tasks = JSON.parse(result.stdout || '[]');
    return tasks.map((t: Record<string, unknown>) => ({
      id: t.id as string,
      title: t.title as string,
      status: mapBeadsStatus(t.status as string),
      tier: extractTier(t.priority as number | undefined, t.labels as string[] | undefined),
      skill: extractSkillFromLabels(t.labels as string[] | undefined),
    }));
  } catch {
    return [];
  }
}

function extractTier(priority: number | undefined, labels: string[] | undefined): number | undefined {
  // Try to get tier from labels first (tier:1, tier:2, etc.)
  if (labels) {
    const tierLabel = labels.find(l => l.startsWith('tier:'));
    if (tierLabel) {
      const tier = parseInt(tierLabel.replace('tier:', ''), 10);
      if (!isNaN(tier)) return tier;
    }
  }
  // Fall back to priority (0-4 maps to tier 1-5)
  if (priority !== undefined) {
    return priority + 1;
  }
  return undefined;
}

function extractSkillFromLabels(labels: string[] | undefined): string | undefined {
  if (!labels) return undefined;
  const skillLabel = labels.find(l => l.startsWith('skill:'));
  return skillLabel?.replace('skill:', '');
}

function mapBeadsStatus(status: string): Task['status'] {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'in_progress';
    case 'complete':
    case 'closed':
      return 'complete';
    case 'blocked':
      return 'blocked';
    default:
      return 'pending';
  }
}
