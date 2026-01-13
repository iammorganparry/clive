import { execSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import type { Task } from '../types.js';

export function isBeadsAvailable(): boolean {
  try {
    execSync('which bd', { stdio: 'ignore' });
    return fs.existsSync('.beads');
  } catch {
    return false;
  }
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
