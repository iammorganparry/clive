import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { Session } from '../types.js';

const CLAUDE_DIR = '.claude';

export function getWorkPlanFiles(): string[] {
  try {
    return glob.sync(`${CLAUDE_DIR}/work-plan-*.md`);
  } catch {
    return [];
  }
}

export function getCurrentPlanPath(): string | null {
  const planPathFile = path.join(CLAUDE_DIR, '.test-plan-path');
  if (fs.existsSync(planPathFile)) {
    return fs.readFileSync(planPathFile, 'utf8').trim();
  }
  return null;
}

export function getCurrentIteration(): { current: number; max: number } | null {
  const stateFile = path.join(CLAUDE_DIR, '.test-loop-state');
  const maxFile = path.join(CLAUDE_DIR, '.test-max-iterations');

  if (!fs.existsSync(stateFile)) {
    return null;
  }

  const current = parseInt(fs.readFileSync(stateFile, 'utf8').trim(), 10);
  let max = 50; // Default

  if (fs.existsSync(maxFile)) {
    max = parseInt(fs.readFileSync(maxFile, 'utf8').trim(), 10);
  }

  return { current, max };
}

export function isCancellationPending(): boolean {
  return fs.existsSync(path.join(CLAUDE_DIR, '.cancel-test-loop'));
}

export function getSessions(): Session[] {
  const planFiles = getWorkPlanFiles();
  const currentPlan = getCurrentPlanPath();
  const iteration = getCurrentIteration();

  return planFiles.map(file => {
    const id = path.basename(file, '.md').replace('work-plan-', '');
    const isActive = currentPlan ? file.includes(currentPlan) || currentPlan.includes(file) : false;

    return {
      id,
      name: id.replace(/-/g, ' '),
      planFile: file,
      isActive,
      iteration: isActive ? iteration?.current : undefined,
      maxIterations: isActive ? iteration?.max : undefined,
    };
  });
}

export function extractBranchFromPlanFile(planFile: string): string {
  return path.basename(planFile, '.md').replace('work-plan-', '');
}
