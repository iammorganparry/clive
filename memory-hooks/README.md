# Clive Memory Hooks

Persistent semantic memory for Claude Code sessions. Memories are automatically injected and extracted via hooks, giving Claude continuity across sessions — decisions, gotchas, patterns, and failures carry forward.

## How it works

| Hook | When | What |
|------|------|------|
| **SessionStart** | New session begins | Injects workspace memories, last session summary, app knowledge |
| **UserPromptSubmit** | Every user message | Searches for relevant memories with progressive disclosure |
| **PreToolUse** | Before Write/Edit | Warns about known gotchas for files being modified |
| **PreCompact** | Context compaction | Saves conversation context, triggers memory lifecycle |
| **Stop** | Session ends | Summarizes transcript and stores session summary |
| **PostToolUse** | After any tool use | Captures observations for richer session data |

Claude can also store memories directly during sessions using helper scripts:

```bash
# Store a memory
bash ~/.claude/memory/hooks/remember.sh GOTCHA "content" "tags" 0.9

# Signal a memory was helpful
bash ~/.claude/memory/hooks/promote.sh MEMORY_ID helpful

# Replace an outdated memory
bash ~/.claude/memory/hooks/supersede.sh OLD_ID NEW_ID
```

## Quick Start

### Option A: Claude Code Plugin (Recommended)

The easiest way — hooks and MCP tools register automatically:

```bash
# From inside Claude Code, install as a local plugin:
/plugin install ./memory-hooks

# Or test without installing:
claude --plugin-dir ./memory-hooks
```

**For team distribution via a marketplace:**

```bash
# Add the marketplace (one-time)
/plugin marketplace add iammorganparry/clive-plugins

# Install the plugin
/plugin install clive-memory@clive-plugins
```

After installing, build the MCP binary (optional, requires Go 1.21+):

```bash
bash memory-hooks/setup.sh
```

Restart Claude Code — memory hooks are active.

### Option B: Bash Installer

Works on any machine with `jq` and `curl`. Doesn't require Claude Code plugin support:

```bash
# 1. Get the package (zip, AirDrop, Slack, etc.)
unzip memory-hooks.zip
# — or clone the repo —
git clone <repo> && cd clive/memory-hooks

# 2. Run the installer
bash install.sh

# 3. Restart Claude Code — done
```

The installer:
1. Copies hook scripts to `~/.claude/memory/hooks/`
2. Builds the MCP server binary to `~/.claude/memory/bin/memory-mcp` (requires Go 1.21+; skipped with warning if unavailable)
3. Auto-generates a namespace from your system username (can be customized)
4. Writes config to `~/.claude/memory/env`
5. Merges hook and MCP entries into `~/.claude/settings.json` (non-destructive)
6. Runs a health check against the memory server

### Option C: Manual Setup

Copy the hook scripts and configure `~/.claude/settings.json` yourself. See the [Manual Configuration](#manual-configuration) section below.

## Prerequisites

- **Required**: `jq`, `curl` (for hook scripts)
- **Optional**: Go 1.21+ (for building the MCP server binary)
- **Memory server**: Hosted at `https://memory-production-23b6.up.railway.app` (default) or run your own

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLIVE_MEMORY_URL` | `https://memory-production-23b6.up.railway.app` | Memory server URL |
| `CLIVE_MEMORY_API_KEY` | _(empty)_ | API key for authenticated servers |

Override the server URL:

```bash
# Use a local server
export CLIVE_MEMORY_URL=http://localhost:8741

# Or set it in the installer
CLIVE_MEMORY_URL=http://localhost:8741 bash install.sh
```

### Memory Types

| Type | Use For |
|------|---------|
| `GOTCHA` | Bugs, edge cases, things that break |
| `WORKING_SOLUTION` | Proven approaches, commands that work |
| `DECISION` | Architectural choices with reasoning |
| `PATTERN` | Code conventions, recurring patterns |
| `FAILURE` | Approaches that didn't work (avoid repeating) |
| `PREFERENCE` | User's stated preferences |
| `CONTEXT` | General project/session information |
| `APP_KNOWLEDGE` | Architecture, data flow, component roles |

### MCP Tools

When the MCP server is installed, these tools are available directly in Claude Code:

| Tool | Description |
|------|-------------|
| `memory_search_index` | Search memories with compact previews |
| `memory_get` | Retrieve full content for specific memory IDs |
| `memory_store` | Store a new memory |
| `memory_impact` | Signal a memory was helpful/promoted/cited |
| `memory_supersede` | Replace an outdated memory |
| `memory_timeline` | Get chronological context around a memory |

## Manual Configuration

Add these entries to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "type": "command", "command": "bash ~/.claude/memory/hooks/session-start.sh" }
    ],
    "UserPromptSubmit": [
      { "type": "command", "command": "bash ~/.claude/memory/hooks/user-prompt-submit.sh" }
    ],
    "PreToolUse": [
      { "matcher": "Write|Edit|MultiEdit", "type": "command", "command": "bash ~/.claude/memory/hooks/pre-tool-use.sh" }
    ],
    "PreCompact": [
      { "type": "command", "command": "bash ~/.claude/memory/hooks/pre-compact.sh" }
    ],
    "Stop": [
      { "type": "command", "command": "bash ~/.claude/memory/hooks/stop.sh" }
    ],
    "PostToolUse": [
      { "type": "command", "command": "bash ~/.claude/memory/hooks/post-tool-use.sh" }
    ]
  },
  "mcpServers": {
    "clive-memory": {
      "command": "~/.claude/memory/bin/memory-mcp",
      "env": { "MEMORY_SERVER_URL": "https://memory-production-23b6.up.railway.app" }
    }
  }
}
```

## Uninstalling

```bash
bash uninstall.sh
```

This removes:
- Hook scripts from `~/.claude/memory/hooks/`
- MCP binary from `~/.claude/memory/bin/`
- Config from `~/.claude/memory/env`
- Hook and MCP entries from `~/.claude/settings.json`
- Empty `~/.claude/memory/` directory (if nothing else is in it)

Your existing Claude Code settings are preserved.

## Verification

After installation, verify everything is working:

```bash
# 1. Check the memory server is reachable
curl https://memory-production-23b6.up.railway.app/health

# 2. Check hooks are installed
ls ~/.claude/memory/hooks/

# 3. Check settings were updated
cat ~/.claude/settings.json | jq '.hooks'

# 4. Start a new Claude Code session — the SessionStart hook should inject memories
```

## Architecture

```
~/.claude/memory/
├── env                     # Config: CLIVE_MEMORY_URL, API key, namespace
├── hooks/                  # Hook scripts (bash, sourcing lib.sh)
│   ├── lib.sh              # Shared utilities, API client, server URL
│   ├── session-start.sh    # SessionStart hook
│   ├── user-prompt-submit.sh  # UserPromptSubmit hook
│   ├── pre-tool-use.sh     # PreToolUse hook (Write/Edit/MultiEdit)
│   ├── pre-compact.sh      # PreCompact hook
│   ├── stop.sh             # Stop hook
│   ├── post-tool-use.sh    # PostToolUse hook
│   ├── remember.sh         # Agent helper: store memories
│   ├── promote.sh          # Agent helper: signal impact
│   └── supersede.sh        # Agent helper: replace memories
└── bin/
    └── memory-mcp          # MCP stdio server (Go binary, optional)
```

All hooks are fail-safe — if the memory server is unreachable, they silently return `{}` and never block Claude Code.
