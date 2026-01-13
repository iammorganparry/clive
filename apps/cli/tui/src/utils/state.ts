import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';
import type { Session } from '../types.js';

const CLAUDE_DIR = '.claude';

export function getWorkPlanFiles(): string[] {
  try {
    // Try both work-plan and test-plan naming for backwards compatibility
    const workPlans = glob.sync(`${CLAUDE_DIR}/work-plan-*.md`);
    const testPlans = glob.sync(`${CLAUDE_DIR}/test-plan-*.md`);
    return [...workPlans, ...testPlans];
  } catch {
    return [];
  }
}

export function getCurrentPlanPath(): string | null {
  // Try new naming first, then legacy
  const planPathFiles = [
    path.join(CLAUDE_DIR, '.build-plan-path'),
    path.join(CLAUDE_DIR, '.test-plan-path'),
  ];

  for (const planPathFile of planPathFiles) {
    if (fs.existsSync(planPathFile)) {
      return fs.readFileSync(planPathFile, 'utf8').trim();
    }
  }
  return null;
}

export function getCurrentIteration(): { current: number; max: number } | null {
  // Try new naming first, then legacy
  const iterationFiles = [
    { state: path.join(CLAUDE_DIR, '.build-iteration'), max: path.join(CLAUDE_DIR, '.build-max-iterations') },
    { state: path.join(CLAUDE_DIR, '.test-loop-state'), max: path.join(CLAUDE_DIR, '.test-max-iterations') },
  ];

  for (const { state, max } of iterationFiles) {
    if (fs.existsSync(state)) {
      const current = parseInt(fs.readFileSync(state, 'utf8').trim(), 10);
      let maxIter = 50; // Default

      if (fs.existsSync(max)) {
        maxIter = parseInt(fs.readFileSync(max, 'utf8').trim(), 10);
      }

      return { current, max: maxIter };
    }
  }

  return null;
}

export function isCancellationPending(): boolean {
  return fs.existsSync(path.join(CLAUDE_DIR, '.cancel-test-loop')) ||
         fs.existsSync(path.join(CLAUDE_DIR, '.cancel-build'));
}

export function isLockFilePresent(): boolean {
  // Check if there's a process lock file indicating active build
  return fs.existsSync(path.join(CLAUDE_DIR, '.build-lock')) ||
         fs.existsSync(path.join(CLAUDE_DIR, '.build-iteration'));
}

export function getSessions(): Session[] {
  const planFiles = getWorkPlanFiles();
  const currentPlan = getCurrentPlanPath();
  const iteration = getCurrentIteration();
  const isBuilding = isLockFilePresent();

  // If there are no plan files but there's a current plan, add it
  if (planFiles.length === 0 && currentPlan && fs.existsSync(currentPlan)) {
    planFiles.push(currentPlan);
  }

  return planFiles.map(file => {
    const id = path.basename(file, '.md')
      .replace('work-plan-', '')
      .replace('test-plan-', '');

    // More robust active detection
    const normalizedFile = path.resolve(file);
    const normalizedCurrent = currentPlan ? path.resolve(currentPlan) : null;
    const isActive = normalizedCurrent !== null && (
      normalizedFile === normalizedCurrent ||
      normalizedFile.includes(path.basename(normalizedCurrent, '.md')) ||
      (normalizedCurrent.includes(path.basename(normalizedFile, '.md')))
    );

    return {
      id,
      name: formatSessionName(id),
      planFile: file,
      isActive: isActive && isBuilding,
      iteration: isActive && isBuilding ? iteration?.current : undefined,
      maxIterations: isActive && isBuilding ? iteration?.max : undefined,
    };
  });
}

function formatSessionName(id: string): string {
  // Convert kebab-case to Title Case
  return id
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function extractBranchFromPlanFile(planFile: string): string {
  return path.basename(planFile, '.md')
    .replace('work-plan-', '')
    .replace('test-plan-', '');
}

export function getProgressContent(): string | null {
  const progressFile = path.join(CLAUDE_DIR, 'progress.txt');
  if (fs.existsSync(progressFile)) {
    return fs.readFileSync(progressFile, 'utf8');
  }
  return null;
}
