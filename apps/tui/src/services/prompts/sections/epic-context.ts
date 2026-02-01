import { Effect } from "effect";
import type { BuildConfig, PromptBuildError } from "../types";

/**
 * Epic context section
 * Injects epic ID and worktree context into the system prompt.
 *
 * - Plan mode: emits CLIVE_PARENT_ID and worktree creation instructions
 * - Build mode: reads worktree state files and emits isolation context
 * - No epicId: returns empty string (no-op)
 */
export const epicContext = (
  config: BuildConfig,
): Effect.Effect<string, PromptBuildError> =>
  Effect.gen(function* () {
    const { epicId, epicIdentifier, mode, workspaceRoot } = config;

    if (!epicId) {
      return "";
    }

    if (mode === "plan") {
      return buildPlanModeContext(epicId, epicIdentifier);
    }

    if (mode === "build") {
      return buildBuildModeContext(workspaceRoot, epicId, epicIdentifier);
    }

    return "";
  });

function buildPlanModeContext(
  epicId: string,
  epicIdentifier?: string,
): string {
  const identifier = epicIdentifier ?? epicId;
  const branchName = `clive/${identifier}`;

  return `
EPIC CONTEXT:
The TUI has an active epic selected. The following environment variable is available in your bash environment:
  CLIVE_PARENT_ID="${epicId}"
  CLIVE_EPIC_IDENTIFIER="${identifier}"

WORKTREE SETUP (MANDATORY when CLIVE_PARENT_ID is set):
You MUST create a git worktree for isolated work on this epic. Follow these steps:

1. Derive paths:
   BRANCH="${branchName}"
   REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")
   WORKTREE_DIR="../\${REPO_NAME}-worktrees/${identifier}"

2. Create worktree (skip if already exists):
   if [ -d "$WORKTREE_DIR" ]; then
     echo "Worktree already exists at $WORKTREE_DIR"
   elif git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
     git worktree add "$WORKTREE_DIR" "$BRANCH"
   else
     git worktree add -b "$BRANCH" "$WORKTREE_DIR" origin/main
   fi

3. Write metadata to MAIN repo (so TUI can find the worktree):
   mkdir -p ".claude/epics/$CLIVE_PARENT_ID"
   cat > ".claude/epics/$CLIVE_PARENT_ID/worktree.json" << EOF
   {
     "worktreePath": "$(cd "$WORKTREE_DIR" && pwd)",
     "branchName": "$BRANCH",
     "epicId": "$CLIVE_PARENT_ID",
     "epicIdentifier": "$CLIVE_EPIC_IDENTIFIER",
     "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
   }
   EOF

4. Write state files INSIDE the worktree (so build agent can verify):
   mkdir -p "$WORKTREE_DIR/.claude"
   echo "$BRANCH" > "$WORKTREE_DIR/.claude/.worktree-branch"
   echo "$(cd "$WORKTREE_DIR" && pwd)" > "$WORKTREE_DIR/.claude/.worktree-path"
   echo "$(git rev-parse --show-toplevel)" > "$WORKTREE_DIR/.claude/.worktree-origin"

5. Install dependencies in worktree:
   cd "$WORKTREE_DIR" && yarn install --frozen-lockfile

After worktree creation, continue planning from the MAIN repo (do NOT cd into the worktree).
The TUI will automatically route build sessions to the worktree directory.
`;
}

function buildBuildModeContext(
  workspaceRoot?: string,
  epicId?: string,
  epicIdentifier?: string,
): string {
  if (!workspaceRoot) {
    return "";
  }

  const sections: string[] = [];

  sections.push(`WORKTREE CONTEXT:
This build session may be running in a git worktree. Check for worktree state:

If the file ".claude/.worktree-branch" exists in the current directory, you are in a worktree.
- Read it to confirm you are on the expected branch
- All work MUST stay within this worktree directory
- Do NOT modify files in the main repository
- The main repo path is in ".claude/.worktree-origin" if you need to reference it

Verify workspace before starting:
  if [ -f ".claude/.worktree-branch" ]; then
      EXPECTED_BRANCH=$(cat .claude/.worktree-branch)
      CURRENT_BRANCH=$(git branch --show-current)
      if [ "$CURRENT_BRANCH" != "$EXPECTED_BRANCH" ]; then
          echo "WARNING: Expected branch $EXPECTED_BRANCH but on $CURRENT_BRANCH"
          git checkout "$EXPECTED_BRANCH"
      fi
      echo "Working in worktree: $(pwd) (branch: $CURRENT_BRANCH)"
  else
      echo "Working in main repo: $(pwd) (branch: $(git branch --show-current))"
  fi`);

  if (epicId) {
    sections.push(`LINEAR EPIC CONTEXT:
You are working on sub-tasks of a Linear epic.
  CLIVE_PARENT_ID="${epicId}"${epicIdentifier ? `\n  CLIVE_EPIC_IDENTIFIER="${epicIdentifier}"` : ""}

To find sub-issues assigned to this epic:
  mcp__linear__list_issues with parentId="${epicId}"

When you pick up a task, update its status to "In Progress":
  mcp__linear__update_issue with id=<issue-id> and state="In Progress"

When you complete a task, update its status to "Done":
  mcp__linear__update_issue with id=<issue-id> and state="Done"`);
  }

  return `\n${sections.join("\n\n")}\n`;
}
