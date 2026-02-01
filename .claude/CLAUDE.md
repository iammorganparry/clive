# Clive — Project-Level Claude Instructions

## Proactive Memory Creation

You have a persistent memory system. Proactively store learnings during sessions so future sessions benefit.

### When to Store

- After fixing a bug or resolving an error → `GOTCHA` (what broke + root cause)
- After finding a working approach via trial/error → `WORKING_SOLUTION`
- After making an architectural or design choice → `DECISION` (choice + reasoning)
- After discovering a recurring code pattern → `PATTERN`
- After an approach fails and you pivot → `FAILURE` (what + why it failed)
- When the user states a preference → `PREFERENCE`

### Proactive App Documentation (APP_KNOWLEDGE)

As you build, modify, or explore the app, proactively document your understanding so future sessions have deep context. Store `APP_KNOWLEDGE` memories for knowledge that transcends individual bugs or decisions — the kind of understanding you wish you'd had when you started the session.

#### What to Document

| Category | Tag | Example |
|----------|-----|---------|
| Architecture | `arch:overview` | "The monorepo has 5 apps: extension (VS Code), dashboard (Next.js), nextjs (web), slack (integration), worker (distributed)" |
| Data Flow | `arch:data-flow` | "Dashboard fetches data via tRPC router in packages/api, which calls services using Drizzle ORM against Supabase Postgres" |
| Component Roles | `arch:component` | "CliveViewProvider bridges VS Code extension services with the React UI via postMessage" |
| API Contracts | `arch:api` | "The conversation router exposes getById, list, create, update, delete. Input validated with Zod from packages/validators" |
| Business Logic | `arch:logic` | "Test generation: user selects file → SourceFileFilter extracts testable code → TestingAgent generates Cypress tests → CompletionDetector validates" |
| Configuration | `arch:config` | "Extension settings managed by ConfigService (Tier 1), reads from VS Code workspace config under 'clive.*' namespace" |
| Key Dependencies | `arch:deps` | "Effect-TS used for all side effects. Services organized in 4 tiers via layer-factory.ts, composed using createCoreLayer()" |

#### When to Document

- **After exploring unfamiliar code** — Capture the understanding you just built
- **After building a new feature** — Document what you built, how it connects, its key interfaces
- **After refactoring** — Update knowledge about the changed component's role
- **After a significant debugging session** — The system understanding you gained is valuable
- **When you realize "future me needs to know this"** — Trust that instinct

#### How to Store

```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/remember.sh APP_KNOWLEDGE \
  "The dashboard app (apps/dashboard) uses Next.js App Router with tRPC for API calls. Routes defined in packages/api/src/root.ts. Auth uses Better Auth for web, Clerk for the extension." \
  "arch:overview,dashboard,trpc,auth" 0.9 \
  "apps/dashboard/src/app/layout.tsx,packages/api/src/root.ts"
```

#### Guidelines

- Write each memory as a **standalone paragraph** — future sessions have zero context from this session
- Include **file paths** when describing where something lives
- Use the **tag prefixes** above (`arch:overview`, `arch:data-flow`, etc.) for structured retrieval
- Prefer **accuracy over comprehensiveness** — one precise memory beats a vague overview
- **Confidence 0.9+** for verified-by-reading-code; 0.7–0.8 for inferred understanding
- **Supersede outdated knowledge** — when you refactor something, store new APP_KNOWLEDGE and supersede the old
- Aim for **2–5 APP_KNOWLEDGE memories per feature session**, fewer for bug fixes

### When NOT to Store

- Routine file edits or trivial changes
- Information already in CLAUDE.md or project docs
- Ephemeral details (line numbers, temp file paths)
- Obvious language features or standard library usage

### How to Store

```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/remember.sh TYPE "content" "tag1,tag2" CONFIDENCE
```

**Types:** `GOTCHA` | `WORKING_SOLUTION` | `DECISION` | `PATTERN` | `FAILURE` | `PREFERENCE` | `APP_KNOWLEDGE`

**Confidence:** 0.9+ = proven, 0.7–0.8 = confident, 0.5–0.6 = uncertain

**Examples:**
```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/remember.sh GOTCHA "SQLite FTS5 requires -tags sqlite_fts5 build flag or queries silently return no results" "sqlite,build,go" 0.95
bash /Users/morganparry/repos/clive/apps/memory/hooks/remember.sh DECISION "Chose hybrid BM25+vector search over pure vector for better keyword matching on short queries" "search,architecture" 0.85
```

### Guidelines

- Store 1–3 memories per session; quality over quantity
- Write content as a standalone sentence (future you has no session context)
- Include the WHY, not just the WHAT
- Do not ask permission; store when appropriate

### Post-Implementation Reflection Protocol

After completing any non-trivial implementation (features, bug fixes, refactoring,
infrastructure), run this reflection BEFORE your final response:

1. **What decisions did I make, and why?** → `DECISION` (0.85+)
   Include the choice, alternatives considered, and reasoning.

2. **What broke or surprised me?** → `GOTCHA` (0.9+)
   Include the symptom, root cause, and how to avoid it.

3. **What non-obvious approach worked?** → `WORKING_SOLUTION` (0.85+)
   Include the problem, solution, and why it works.

4. **What did I try that failed?** → `FAILURE` (0.8+)
   Include the approach, why it seemed reasonable, and why it failed.

5. **What did I build and how does it connect?** → `APP_KNOWLEDGE` (0.9+)
   Document the component's purpose, its interfaces, how it connects to adjacent
   systems, and any non-obvious architectural constraints. Include file paths.
   Skip for trivial changes; required for new features, new services, new routes,
   or significant refactors.

Rules:
- Skip questions that don't apply (trivial edits, pure docs)
- Minimum 1 memory per implementation session, maximum 5
- Each memory MUST be a standalone sentence (no session context)
- Include the WHY, not just the WHAT
- Store immediately before your final summary — don't ask permission

### Impact Signaling & File Linking

When a recalled memory directly helps your work, signal its impact:

```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/promote.sh MEMORY_ID helpful     # memory was useful
bash /Users/morganparry/repos/clive/apps/memory/hooks/promote.sh MEMORY_ID promoted    # promote to permanent long-term
```

When storing memories, include related file paths:

```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/remember.sh GOTCHA "content" "tags" 0.9 "src/services/foo.ts,src/utils/bar.ts"
```

### Superseding Outdated Memories

When `remember.sh` reports a near-duplicate, the new memory is stored but the old one remains. If the new memory replaces/corrects the old one, supersede it:

```bash
bash /Users/morganparry/repos/clive/apps/memory/hooks/supersede.sh OLD_MEMORY_ID NEW_MEMORY_ID
```

Superseded memories are excluded from future searches. Use this when:
- You discover a previous GOTCHA or WORKING_SOLUTION was wrong or outdated
- A new DECISION replaces a previous architectural choice
- A PATTERN has evolved into a different form

Guidelines:
- Signal `helpful` max 2x per session — only for genuinely impactful memories
- Signal `promoted` when a memory saved significant debugging time
- The memory ID is in the `id` attribute of `<memory>` tags from recalled memories
- Always include related files when a memory is about specific code
- Use workspace-relative paths (src/services/foo.ts, not absolute)
- When `remember.sh` reports a near-duplicate, consider whether to supersede the old memory

## Plan Mode Memory Protocol

When entering plan mode to design an implementation approach, **check recalled memories BEFORE exploring the codebase**. Memories from past sessions contain decisions, gotchas, patterns, and failures that should guide your exploration direction.

### Before Launching Explore Agents

1. **Review `<recalled-memories>` blocks** — The UserPromptSubmit hook automatically injects relevant memories when you receive the user's task. Scan these for:
   - **File paths** mentioned in memory content → explore those files first
   - **GOTCHA memories** → avoid repeating known pitfalls
   - **DECISION memories** → respect past architectural choices unless the user explicitly wants to change direction
   - **PATTERN memories** → follow established code patterns
   - **FAILURE memories** → skip approaches already proven not to work

2. **Feed memory insights into Explore agent prompts** — When launching Explore agents, include memory-derived context:
   ```
   Bad:  "Explore how authentication works in this codebase"
   Good: "Explore how authentication works. Memory says auth uses Better Auth (web) and
          Clerk (extension), with config in packages/auth/. Check there first."
   ```

3. **Search for more memories if needed** — If the auto-injected memories don't cover the task area, do a targeted search:
   ```bash
   curl -s -X POST http://localhost:8741/memories/search \
     -H 'Content-Type: application/json' \
     -d '{"workspace":"'"$(pwd)"'","query":"<specific topic>","maxResults":5,"minScore":0.3,"includeGlobal":true,"searchMode":"hybrid"}'
   ```

### During Plan Design

- When proposing file changes, cross-reference with recalled GOTCHA and FAILURE memories
- When choosing between approaches, check if a DECISION memory already covers this choice
- When estimating scope, check WORKING_SOLUTION memories for proven approaches to similar tasks
- Signal `helpful` on any memory that actively shaped your plan
