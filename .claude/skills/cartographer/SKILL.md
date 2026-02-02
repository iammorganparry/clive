---
name: cartographer
description: Explore and maintain architecture map of the codebase. Use when asking about codebase structure, system architecture, package relationships, data flow, or wanting to understand how components connect. Produces .claude/architecture-map.md
allowed-tools: Read, Glob, Grep, Bash(ls:*), Bash(tree:*), Write, Edit
---

# Codebase Cartographer

Map and document the architecture of this codebase, maintaining a living document at `.claude/architecture-map.md`.

## When This Skill Activates

- Questions about codebase structure or architecture
- Requests to understand how packages/apps relate
- Onboarding or orientation needs
- After major refactors or structural changes
- "Where does X live?" or "How does Y connect to Z?"

## Workflow

### Step 1: Load Existing Map

Read the current architecture map if it exists:
```
.claude/architecture-map.md
```

Note the `Last updated` timestamp to determine if a refresh is needed.

### Step 2: Scan Structure

Explore key areas systematically:

**Root Structure:**
```bash
ls -la  # Root directory
ls apps/  # Applications
ls packages/  # Shared packages
```

**For Each App** (apps/*):
- Read `package.json` for dependencies and scripts
- Identify entry points (src/index.ts, src/app/, pages/)
- Note the tech stack and purpose

**For Each Package** (packages/*):
- Read `package.json` for exports and dependencies
- Read `src/index.ts` or main entry for public API
- Identify internal vs external dependencies

**Configuration Files:**
- `turbo.json` - Build pipeline and dependencies
- `tsconfig.json` - TypeScript paths and references
- `package.json` (root) - Workspace configuration

### Step 3: Analyze Relationships

Map dependencies between packages:
```bash
grep -r "from \"@trigify" packages/ --include="*.ts" | head -50
```

Identify data flow patterns:
- Database access points
- API entry points
- Event/message flows

### Step 4: Update Architecture Map

Write/update `.claude/architecture-map.md` with the template below.

## Architecture Map Template

```markdown
# Trigify Architecture Map

> Last updated: YYYY-MM-DD
> Cartographer skill revision

## Quick Reference

| App/Package | Purpose | Key Entry |
|-------------|---------|-----------|
| @trigify/app | Next.js frontend | apps/nextjs/src/app |
| ... | ... | ... |

## System Overview

[ASCII diagram or description of high-level architecture]

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   tRPC API  │────▶│  Services   │
│  (Next.js)  │     │  (routes)   │     │ (Effect-TS) │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                    ┌─────────────┐     ┌──────▼──────┐
                    │   Inngest   │◀────│  Database   │
                    │ (bg jobs)   │     │ (Postgres)  │
                    └─────────────┘     └─────────────┘
```

## Applications

### apps/nextjs (@trigify/app)
- **Purpose**: Main web application
- **Stack**: Next.js, React, tRPC, TailwindCSS
- **Entry**: `src/app/` (App Router)
- **Key Directories**:
  - `src/app/` - Pages and routes
  - `src/components/` - React components
  - `src/server/` - tRPC routers
  - `src/lib/` - Utilities

### apps/inngest (@trigify/backend)
- **Purpose**: Background job processing
- **Stack**: Hono, Inngest
- **Entry**: `src/index.ts`
- **Functions**: [list key functions]

### apps/api (@trigify/api)
- **Purpose**: Public REST API
- **Stack**: Hono
- **Entry**: `src/index.ts`

### apps/docs
- **Purpose**: Documentation site
- **Stack**: [identify]

## Packages

### Core Packages

#### packages/services (@trigify/services)
- **Purpose**: Shared business logic
- **Pattern**: Effect-TS services
- **Exports**: [key services]
- **Used by**: nextjs, inngest, api

#### packages/workflows (@trigify/workflows)
- **Purpose**: Visual workflow engine
- **Based on**: @inngest/workflow-kit fork
- **Exports**: [key exports]

#### packages/inngest (@trigify/inngest)
- **Purpose**: Inngest client and events
- **Exports**: Client, event schemas, executors

### Data Packages

#### packages/prisma (@trigify/prisma)
- **Purpose**: PostgreSQL ORM
- **Schema**: `schema/schema.prisma`
- **Models**: [key models]

#### packages/mongo (@trigify/mongo)
- **Purpose**: MongoDB for social data
- **Schema**: `prisma/schema.prisma`
- **Models**: [key models]

### Utility Packages

#### packages/types (@trigify/types)
- **Purpose**: Shared TypeScript types
- **Exports**: [key types]

#### packages/utils (@trigify/utils)
- **Purpose**: Shared utilities
- **Exports**: [key utilities]

## Data Flow

### Request Flow
1. Client makes request to Next.js
2. tRPC router receives and validates
3. Router calls @trigify/services
4. Service uses Effect-TS patterns
5. Data accessed via Prisma/Mongo
6. Response returned through stack

### Background Job Flow
1. Event triggered (tRPC/webhook/schedule)
2. Inngest receives event
3. @trigify/backend processes
4. Services called via @trigify/services
5. Database updated

### Workflow Execution
1. User creates workflow in UI
2. Workflow saved to database
3. Trigger activates workflow
4. @trigify/workflows engine executes steps
5. Actions call external APIs/services

## Key Patterns

### Effect-TS Service Pattern
All backend services use Effect-TS for:
- Typed errors
- Dependency injection
- Structured logging
- Composable operations

### tRPC + React Query
Frontend data fetching via tRPC with automatic:
- Type safety
- Caching
- Optimistic updates

### Inngest Durable Functions
Background jobs are durable with:
- Automatic retries
- Step functions
- Event-driven triggers

## Dependency Graph

```
@trigify/app
├── @trigify/services
├── @trigify/prisma
├── @trigify/types
└── @trigify/utils

@trigify/backend
├── @trigify/inngest
├── @trigify/services
├── @trigify/workflows
└── @trigify/prisma

@trigify/services
├── @trigify/prisma
├── @trigify/mongo
├── @trigify/types
└── @trigify/utils
```

## Common Tasks

| Task | Start Here |
|------|------------|
| Add new page | apps/nextjs/src/app/ |
| Add tRPC endpoint | apps/nextjs/src/server/api/routers/ |
| Add business logic | packages/services/src/ |
| Add background job | apps/inngest/src/functions/ |
| Add workflow action | packages/workflows/src/actions/ |
| Modify database | packages/prisma/schema/ |

## External Integrations

| Service | Package/Location | Purpose |
|---------|------------------|---------|
| Clerk | apps/nextjs | Authentication |
| Stripe | packages/services | Payments |
| Supabase | packages/prisma | Database hosting |
| Inngest | apps/inngest | Job orchestration |
| [others] | ... | ... |
```

## Output

After mapping:
1. Confirm architecture map was created/updated
2. Summarize key structural insights
3. Note any inconsistencies or concerns found
4. Provide the path to the map file

## Refresh Triggers

Consider refreshing the map when:
- More than 2 weeks since last update
- New apps or packages added
- Major refactoring occurred
- Dependencies significantly changed
