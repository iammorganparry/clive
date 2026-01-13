import * as fs from 'node:fs';
import type { Task } from '../types.js';

export function parseTasksFromPlan(planFile: string): Task[] {
  if (!fs.existsSync(planFile)) return [];

  const content = fs.readFileSync(planFile, 'utf8');
  const tasks: Task[] = [];

  // Match task headers like "### Task 1: Description"
  const taskRegex = /### Task \d+: (.+)\n([\s\S]*?)(?=### Task|\n## |$)/g;
  let match;

  while ((match = taskRegex.exec(content)) !== null) {
    const title = match[1].trim();
    const body = match[2];

    const status = parseStatus(body);
    const skill = parseField(body, 'Skill');
    const category = parseField(body, 'Category');
    const target = parseField(body, 'Target');

    tasks.push({
      id: `task-${tasks.length + 1}`,
      title,
      status,
      skill,
      category,
      target,
    });
  }

  return tasks;
}

function parseStatus(body: string): Task['status'] {
  if (body.includes('[x] **Status:** complete')) return 'complete';
  if (body.includes('[ ] **Status:** in_progress')) return 'in_progress';
  if (body.includes('[ ] **Status:** blocked')) return 'blocked';
  if (body.includes('[x] **Status:** skipped')) return 'skipped';
  return 'pending';
}

function parseField(body: string, field: string): string | undefined {
  const regex = new RegExp(`\\*\\*${field}:\\*\\*\\s*\`?([^\`\\n]+)\`?`);
  const match = body.match(regex);
  return match?.[1]?.trim();
}

export function getPlanMetadata(planFile: string): {
  branch?: string;
  mode?: string;
  request?: string;
  category?: string;
  skill?: string;
} {
  if (!fs.existsSync(planFile)) return {};

  const content = fs.readFileSync(planFile, 'utf8');
  const metadata: Record<string, string> = {};

  // Parse header fields
  const branchMatch = content.match(/Branch:\s*(.+)/);
  if (branchMatch) metadata.branch = branchMatch[1].trim();

  const modeMatch = content.match(/Mode:\s*(.+)/);
  if (modeMatch) metadata.mode = modeMatch[1].trim();

  const requestMatch = content.match(/Request:\s*(.+)/);
  if (requestMatch) metadata.request = requestMatch[1].trim();

  const categoryMatch = content.match(/\*\*Category:\*\*\s*(.+)/);
  if (categoryMatch) metadata.category = categoryMatch[1].trim();

  const skillMatch = content.match(/\*\*Default Skill:\*\*\s*(.+)/);
  if (skillMatch) metadata.skill = skillMatch[1].trim();

  return metadata;
}
