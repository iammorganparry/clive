import * as fs from 'node:fs';
import * as path from 'node:path';

const CLAUDE_DIR = '.claude';

// Get current build iteration from state files
export function getCurrentIteration(): { current: number; max: number } | null {
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

// Check if a cancellation has been requested
export function isCancellationPending(): boolean {
  return fs.existsSync(path.join(CLAUDE_DIR, '.cancel-test-loop')) ||
         fs.existsSync(path.join(CLAUDE_DIR, '.cancel-build'));
}

// Check if a build is currently running
export function isLockFilePresent(): boolean {
  return fs.existsSync(path.join(CLAUDE_DIR, '.build-lock')) ||
         fs.existsSync(path.join(CLAUDE_DIR, '.build-iteration'));
}

// Get progress file content (for build output)
export function getProgressContent(): string | null {
  const progressFile = path.join(CLAUDE_DIR, 'progress.txt');
  if (fs.existsSync(progressFile)) {
    return fs.readFileSync(progressFile, 'utf8');
  }
  return null;
}
