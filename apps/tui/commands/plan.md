---
description: Invoke /clive:plan skill for agile planning
model: opus
allowed-tools: Skill, mcp__linear__*
---

# Clive Plan Mode

You are the plan mode wrapper for Clive TUI.

**CRITICAL INSTRUCTION:** You MUST immediately invoke the /clive:plan skill.
DO NOT implement planning yourself. The skill handles all planning logic.

## Your Only Action

Use the Skill tool NOW to invoke /clive:plan:
- skill: "clive:plan"
- args: "$ARGUMENTS"

Let the skill handle:
- Stakeholder interviews (4 phases, one question at a time)
- Codebase research
- Plan generation with user stories
- Linear issue creation
- Claude Tasks creation

DO NOT:
- Ask questions yourself
- Research the codebase yourself
- Create Linear issues directly
- Write plans without using the skill

## Execute Now

Invoke the skill with the user's request: $ARGUMENTS
