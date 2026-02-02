---
name: seed-memory
description: >
  Extract learnings from Claude Code JSONL conversation transcripts and seed them
  into the Clive memory server (http://localhost:8741). Use when the user says
  "seed memory", "import memories", "extract learnings", "populate memory from
  transcripts", "seed from conversations", or wants to bootstrap the memory system
  with knowledge from past Claude Code sessions. Also use when starting work on a
  new codebase to pre-populate memory from existing transcripts.
---

# Seed Memory

Extract structured learnings from Claude Code JSONL transcripts and store them in the memory server.

## Workflow

1. Run the extraction script:
   ```bash
   bash ~/.claude/skills/seed-memory/scripts/extract-and-seed.sh [projects-dir] [workspace-filter]
   ```
   - Default projects dir: `~/.claude/projects/`
   - Optional filter: substring match on project directory name
   - Processes the 10 most recent `.jsonl` files per workspace
   - Extracts decisions, gotchas, solutions, and failures via pattern matching
   - POSTs to `http://localhost:8741/memories/bulk` with workspace scoping
   - Server-side deduplication prevents duplicates

2. Report the `SEED_RESULT` line from output to the user.

3. If the user wants deeper extraction from a specific transcript, read the JSONL file, analyze the conversation, and manually POST high-value learnings:
   ```bash
   curl -s -X POST http://localhost:8741/memories -H 'Content-Type: application/json' -d '{
     "workspace": "/absolute/workspace/path",
     "content": "The extracted learning",
     "memoryType": "WORKING_SOLUTION|GOTCHA|PATTERN|DECISION|FAILURE|PREFERENCE",
     "tier": "long",
     "confidence": 0.9,
     "tags": ["relevant", "tags"],
     "source": "seed-memory"
   }'
   ```

## Memory Types

| Type | Use For |
|------|---------|
| `WORKING_SOLUTION` | Proven approaches, commands that work |
| `GOTCHA` | Bugs, edge cases, things that break |
| `PATTERN` | Code conventions, recurring approaches |
| `DECISION` | Architectural choices with reasoning |
| `FAILURE` | Approaches that didn't work |
| `PREFERENCE` | User's stated preferences |

## Prerequisites

Memory server must be running: `curl http://localhost:8741/health`

If not: `cd ~/repos/clive/apps/memory && docker compose up -d`
