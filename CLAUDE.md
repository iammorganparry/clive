# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Clive is a VS Code extension that provides AI-powered Cypress test writing capabilities. Built as a Turborepo monorepo with TypeScript, Effect-TS for functional programming, React Query for state management, and tRPC for API communication.

## Essential Commands

### Development
```bash
# Install dependencies
yarn install

# Start all apps in watch mode
yarn dev

# Start only Next.js app
yarn dev:next

# Build all packages
yarn build

# Type checking
yarn typecheck

# Format and lint
yarn format:fix
yarn lint:fix
```

### Database
```bash
# Push database schema changes
yarn db:push

# Generate Better Auth schema
yarn auth:generate

# Open Drizzle Studio
yarn db:studio

# Start local Supabase Postgres
docker-compose up -d
```

### Extension Development
```bash
# Build extension (from root)
yarn workspace clive compile

# Watch mode for extension
yarn workspace clive watch

# Package extension as VSIX
yarn workspace clive package:vsix

# Install extension locally
yarn extension:install

# Install in Cursor
yarn extension:install:cursor
```

### Testing
```bash
# Run unit tests
yarn test

# Run integration tests
yarn test:int

# Extension-specific tests
yarn workspace clive test:unit
yarn workspace clive test:unit:watch
```

## Architecture

### Monorepo Structure

```
apps/
  ├─ extension/          # VS Code extension (main product)
  ├─ dashboard/          # Next.js dashboard application
  └─ nextjs/             # Next.js web application

packages/
  ├─ api/                # tRPC v11 router definitions
  ├─ auth/               # Better Auth configuration
  ├─ core/               # Core business logic
  ├─ db/                 # Drizzle ORM & Supabase schema
  ├─ prompts/            # AI prompts and templates
  ├─ ui/                 # Shared UI components (shadcn/ui)
  ├─ validators/         # Shared Zod schemas
  ├─ webview-rpc/        # Webview RPC communication
  └─ claude-services/    # Claude API integration

tooling/
  ├─ biome/              # Shared Biome configuration
  ├─ tailwind/           # Shared Tailwind theme
  └─ typescript/         # Shared TypeScript configs
```

### Extension Architecture

The VS Code extension follows a clean architecture with strict separation:

```
src/
├── extension.ts           # Extension entry point with Effect-TS
├── constants.ts           # All magic strings and IDs (Commands, Views, WebviewMessages)
├── commands/
│   └── command-center.ts  # Centralized command registration
├── services/              # Business logic with Effect-TS
│   ├── layer-factory.ts   # Service layer composition
│   ├── config-service.ts  # Configuration management
│   ├── ai-provider-factory.ts
│   └── [domain services]
├── views/                 # Webview providers
│   └── clive-view-provider.ts
├── webview/               # React webview UI
│   ├── App.tsx            # Root with React Query
│   └── components/
├── mcp-bridge/            # MCP server integration
│   ├── runtime.ts
│   ├── handlers.ts
│   └── manager.ts
└── utils/                 # Pure utilities
```

**Key Patterns:**
- **Effect-TS**: All side effects use `pipe()` and Effect combinators (`Effect.sync`, `Effect.promise`, `Effect.flatMap`, `Effect.map`)
- **Service Layers**: Tiered architecture (Tier 0: Core, Tier 1: Base, Tier 2: Domain, Tier 3: Features)
- **Message-Based Communication**: Webview ↔ Extension via `WebviewMessages` constants
- **React Query**: `useQuery` for data fetching, `useMutation` for actions
- **Functional Composition**: Declarative code over imperative

### Effect-TS Service Layers

Services are organized in tiers (see `src/services/layer-factory.ts`):

- **Tier 0 (Core)**: VSCodeService, SecretStorage, Logger (context-dependent)
- **Tier 1 (Base)**: ConfigService, ApiKeyService (common business logic)
- **Tier 2 (Domain)**: RepositoryService, ConversationService, SourceFileFilter
- **Tier 3 (Features)**: KnowledgeBaseAgent, TestingAgent, CompletionDetector

Always use `createCoreLayer()` factory for layer composition instead of manually composing layers.

### Webview Communication Pattern

**Extension → Webview:**
1. Extension calls service (e.g., `checkPlaywrightStatus()`)
2. Sends message via `webview.postMessage({ command: WebviewMessages.playwrightStatus, status })`
3. Webview receives in `handleMessage` and updates React Query cache

**Webview → Extension:**
1. Webview sends message via `vscode.postMessage({ command: WebviewMessages.setupPlaywright })`
2. Extension receives in `onDidReceiveMessage` handler
3. Extension calls service and sends response back

**Promise-based Messages:**
Use `createMessagePromise(vscode, command, expectedResponseCommand)` pattern for request/response flows in webview.

### MCP Bridge

The extension includes an MCP (Model Context Protocol) bridge for Claude Code CLI integration:

- **Runtime**: `getMcpBridgeRuntime()` provides shared Effect runtime
- **Handlers**: `createBridgeHandlers()` sets up tool handlers
- **Server**: Manages MCP server lifecycle and communication

## Code Standards

### TypeScript
- **Strict typing**: No `any`, prefer explicit types
- **Interfaces** for object shapes
- **`as const`** for literal types and readonly constants
- **Export types** alongside implementations
- All constants in `src/constants.ts` with `as const`

### Effect-TS Patterns
**Always use Effect for side effects:**

```typescript
// ✅ Good - Declarative with pipe
pipe(
  Effect.sync(() => getValue()),
  Effect.flatMap((value) => Effect.promise(() => process(value))),
  Effect.map((result) => transform(result)),
  Runtime.runPromise(Runtime.defaultRuntime)
);

// ❌ Bad - Imperative
const value = getValue();
const result = await process(value);
return transform(result);
```

**Effect Combinators:**
- `Effect.sync` - synchronous operations
- `Effect.promise` - Promise-based operations
- `Effect.flatMap` - chaining dependent effects
- `Effect.map` - transforming values
- `Runtime.runPromise(Runtime.defaultRuntime)` - executing at the boundary

### React Query Patterns

**Data Fetching:**
```typescript
const { data, isLoading, error } = useQuery({
  queryKey: ['playwright-status'],
  queryFn: async () => {
    const message = await createMessagePromise(
      vscode,
      WebviewMessages.refreshStatus,
      WebviewMessages.playwrightStatus
    );
    return message.status;
  }
});
```

**Mutations:**
```typescript
const mutation = useMutation({
  mutationFn: async (params) => performAction(params),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['related-key'] });
  }
});
```

### File Organization

**Constants:** All magic strings go in `src/constants.ts`:
```typescript
export const Commands = {
  showView: 'clive.showView',
  setupPlaywright: 'clive.setupPlaywright',
} as const;

export const WebviewMessages = {
  refreshStatus: 'refresh-status',
  playwrightStatus: 'playwright-status',
} as const;
```

**Commands:** Register in `CommandCenter` class in `src/commands/command-center.ts`

**Services:** One service per domain in `src/services/`, use Effect-TS patterns

**Components:** Functional React components in `src/webview/components/`

**Naming:**
- Files: kebab-case for services (`playwright-detector.ts`), PascalCase for components (`PlaywrightStatus.tsx`)
- Exports: PascalCase for classes/constants, camelCase for functions

### Declarative Code

**Rules:**
- Use functional composition with `pipe`
- Prefer React Query hooks over manual state management
- Use functional React patterns (hooks, composition, pure components)
- Avoid imperative mutations (prefer immutable updates)

**Immutability:**
```typescript
// ✅ Good
const newArray = [...oldArray, newItem];
const newObject = { ...oldObject, newProp: value };

// ❌ Bad
oldArray.push(newItem);
oldObject.newProp = value;
```

## Tech Stack

- **Package Manager**: Yarn workspaces
- **Build System**: Turborepo
- **Language**: TypeScript (strict mode)
- **Linting/Formatting**: Biome
- **Database**: Supabase Postgres (via Docker Compose)
- **ORM**: Drizzle
- **Auth**: Better Auth (web app), Clerk (extension)
- **API**: tRPC v11
- **UI**: React, Tailwind CSS v4, shadcn/ui
- **Testing**: Vitest (unit), Cypress (E2E for web apps)
- **Functional Programming**: Effect-TS

## Extension Development Workflow

### Building
1. Build UI package (dependency): `yarn workspace @clive/ui build`
2. Build extension: `yarn workspace clive compile`
3. Or use VS Code: `Ctrl+Shift+B` → "build:all"

### Watch Mode
- `F5` in VS Code to launch Extension Development Host
- `Ctrl+Shift+P` → "Tasks: Run Task" → "watch:all" for auto-rebuild
- **Extension changes**: Reload window (`Ctrl+R`) in Extension Development Host
- **Webview changes**: Close and reopen sidebar

### Debugging
- **Extension**: Set breakpoints, use VS Code debugger
- **Webview**: Right-click webview → "Inspect" for Developer Tools
- **Logs**: Output panel → "Clive" channel

### Testing
From root or extension workspace:
```bash
yarn test:unit           # All unit tests
yarn test:unit:watch     # Watch mode
```

## Adding Features

### New Command
1. Add constant to `src/constants.ts`:
   ```typescript
   export const Commands = {
     myNewCommand: 'clive.myNewCommand',
   } as const;
   ```
2. Register in `CommandCenter.registerAll()`
3. Add to `package.json` contributes.commands

### New Service
1. Create in `src/services/` using Effect-TS patterns
2. Add to layer factory if needed for dependency injection
3. Export types and implementation

### New Webview Message
1. Add constant to `src/constants.ts`:
   ```typescript
   export const WebviewMessages = {
     myNewMessage: 'my-new-message',
   } as const;
   ```
2. Handle in `CliveViewProvider.onDidReceiveMessage`
3. Send from webview using message constant

### New UI Component
```bash
yarn ui-add  # Interactive shadcn CLI
```
Adds components to `packages/ui/src/components/ui/`

## Commit Conventions

Uses Conventional Commits with commitlint:

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

**Types:** feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

**Scopes:** extension, webview, services, commands, views, docs, config, build, deps

## Environment Variables

Create `.env` in root:

```bash
# Database
POSTGRES_URL=postgresql://supabase_admin:your-super-secret-and-long-postgres-password@localhost:5432/postgres

# Auth (Next.js)
AUTH_GITHUB_CLIENT_ID=your-github-client-id
AUTH_GITHUB_CLIENT_SECRET=your-github-client-secret

# Clerk (Extension)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

## Troubleshooting

### Extension doesn't load
- Check `dist/extension.js` and `dist/webview/webview.js` exist
- Rebuild UI package: `yarn workspace @clive/ui build`
- Check Debug Console for errors

### Changes not appearing
- Reload Extension Development Host window (`Ctrl+R`)
- For webview: close and reopen sidebar
- Ensure watch tasks are running

### Build errors
```bash
yarn typecheck          # Check TypeScript errors
yarn lint               # Check linting
yarn clean:workspaces   # Clean and rebuild
yarn install
yarn build
```

### Database issues
```bash
docker-compose down -v  # Reset database (deletes data)
docker-compose up -d
yarn db:push            # Re-apply schema
```
