# Development Workspace Configuration

## Problem

When running `yarn dev` from the clive repo, `process.cwd()` returns the clive directory, not the user's actual working directory. This means Claude doesn't have context of the project you want to work on.

## Solution

The TUI now supports a `--workspace` argument that specifies the directory context for Claude.

## Usage

### Option 1: Using the wrapper script (Recommended)

From your project directory:
```bash
cd ~/projects/trigify-app
~/repos/clive/apps/tui/dev.sh
```

This automatically passes your current directory to the TUI.

### Option 2: Using npm scripts

**Dev in current directory:**
```bash
cd ~/projects/trigify-app
cd ~/repos/clive/apps/tui
yarn dev:here
```

**Dev in clive repo (for testing TUI itself):**
```bash
cd ~/repos/clive/apps/tui
yarn dev:clive
```

### Option 3: Manual workspace argument

```bash
cd ~/repos/clive/apps/tui
bun run --watch src/main.tsx --debug --workspace=/Users/user/projects/trigify-app
```

## How It Works

1. The `--workspace=<path>` argument is parsed in `main.tsx`
2. Sets `process.env.CLIVE_WORKSPACE`
3. `App.tsx` uses this value instead of `process.cwd()`
4. Claude CLI is spawned with this directory as `cwd`
5. Status bar shows the workspace folder name

## Verification

When the TUI starts, you should see:
```
[Clive TUI] Starting in workspace: /Users/user/projects/trigify-app
[Clive TUI] Claude will have context of this directory
[Clive TUI] Workspace overridden via --workspace flag (dev mode)
```

And the status bar will show:
```
✓ Ready • 📁 trigify-app
```

## Production

In production (when installed via npm/yarn), the TUI automatically uses the directory where the user runs the `clive` command, so no special configuration is needed.
