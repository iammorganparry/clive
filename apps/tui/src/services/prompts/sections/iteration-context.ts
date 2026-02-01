import * as fs from "node:fs";
import * as path from "node:path";
import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Iteration context section
 * Active only in build mode when iteration is set.
 * Reads scratchpad + learnings from disk and injects iteration context
 * plus completion marker instructions.
 */
export const iterationContext = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { mode, iteration, maxIterations, epicId, workspaceRoot } = config;

    // Only active in build mode with iteration set
    if (mode !== "build" || !iteration) {
      return "";
    }

    const sections: string[] = [];

    // Header
    sections.push(
      `ITERATION CONTEXT: Iteration ${iteration} of ${maxIterations ?? 10}`,
    );

    // Scratchpad context
    const scratchpad = readScratchpad(workspaceRoot, epicId);
    if (scratchpad) {
      sections.push(`SCRATCHPAD (from previous iterations):\n${scratchpad}`);
    } else if (iteration === 1) {
      sections.push(
        "SCRATCHPAD: No previous context (first iteration).",
      );
    }

    // Global learnings
    const learnings = readLearnings(workspaceRoot);
    if (learnings) {
      sections.push(`GLOBAL LEARNINGS:\n${learnings}`);
    }

    // Completion marker instructions
    sections.push(buildCompletionInstructions(epicId));

    return `\n${sections.join("\n\n")}\n`;
  });

/**
 * Read scratchpad from .claude/epics/{epicId}/scratchpad.md
 * Truncates to 3000 chars if too long.
 */
function readScratchpad(
  workspaceRoot?: string,
  epicId?: string,
): string | null {
  if (!workspaceRoot || !epicId) return null;

  const scratchpadPath = path.join(
    workspaceRoot,
    ".claude",
    "epics",
    epicId,
    "scratchpad.md",
  );

  try {
    if (!fs.existsSync(scratchpadPath)) return null;
    const content = fs.readFileSync(scratchpadPath, "utf-8").trim();
    if (!content) return null;
    return content.length > 3000
      ? `${content.slice(0, 3000)}\n... (truncated)`
      : content;
  } catch {
    return null;
  }
}

/**
 * Read global learnings from .claude/learnings/ directory.
 * Reads error-patterns.md, success-patterns.md, and gotchas.md.
 * Each file truncated to 2000 chars.
 */
function readLearnings(workspaceRoot?: string): string | null {
  if (!workspaceRoot) return null;

  const learningsDir = path.join(workspaceRoot, ".claude", "learnings");
  const files = ["error-patterns.md", "success-patterns.md", "gotchas.md"];
  const parts: string[] = [];

  for (const file of files) {
    const filePath = path.join(learningsDir, file);
    try {
      if (!fs.existsSync(filePath)) continue;
      const content = fs.readFileSync(filePath, "utf-8").trim();
      if (!content) continue;
      const label = file.replace(".md", "").replace(/-/g, " ");
      const truncated =
        content.length > 2000
          ? `${content.slice(0, 2000)}\n... (truncated)`
          : content;
      parts.push(`### ${label}\n${truncated}`);
    } catch {
      // Skip unreadable files
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * Build completion marker instructions for the agent.
 */
function buildCompletionInstructions(epicId?: string): string {
  const scratchpadPath = epicId
    ? `.claude/epics/${epicId}/scratchpad.md`
    : ".claude/scratchpad.md";

  const linearUpdateStep = epicId
    ? `3. Update Linear issue status:
   - For the sub-task you just completed: mcp__linear__update_issue with id=<sub-issue-id> and state="Done"
   - If ALL sub-tasks are now done, also update the parent epic: mcp__linear__update_issue with id="${epicId}" and state="In Review"
   - If you don't know the sub-issue ID, list them: mcp__linear__list_issues with parentId="${epicId}"`
    : "3. Update Linear issue status (Done for sub-tasks, In Review for epics)";

  return `COMPLETION PROTOCOL:
After completing your assigned task:

1. Verify: tests pass, build succeeds
2. Git commit (local only, do NOT push)
${linearUpdateStep}
4. Update scratchpad at ${scratchpadPath} with:
   - What was completed
   - Any issues encountered
   - Context for the next iteration
5. Emit EXACTLY ONE of these markers as the LAST thing you output:
   - If more tasks remain: <promise>TASK_COMPLETE</promise>
   - If ALL tasks are done: <promise>ALL_TASKS_COMPLETE</promise>
6. STOP IMMEDIATELY after emitting the marker. Do not output anything else.

IMPORTANT: The TUI controls the iteration loop. Do NOT try to do multiple tasks in one invocation.
Execute ONE task, commit, update scratchpad, emit the marker, and STOP.`;
}
