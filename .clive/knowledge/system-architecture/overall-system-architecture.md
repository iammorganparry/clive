---
category: "system-architecture"
title: "Overall System Architecture"
sourceFiles:
  - apps/extension/src/extension.ts
  - packages/db/src/schema.ts
  - apps/extension/src/services/ai-agent/agent.ts
updatedAt: "2025-12-26"
---

The system is a VSCode extension with AI-powered testing capabilities, built as a monorepo with multiple packages. It provides intelligent test generation and execution through AI agents, with a web-based UI for user interaction.

### Context for Testing
Understanding the architecture helps identify integration points and data flow that need testing. The modular design allows for isolated unit testing while requiring careful integration testing across boundaries.

### Overview
This is a VSCode extension that uses AI to analyze codebases and generate/maintain tests. The architecture follows a layered approach with clear separation between extension logic, UI, API, and data persistence.

### Core Components
- **VSCode Extension**: Entry point, manages extension lifecycle, AI agents
- **Webview UI**: React-based interface for user interactions
- **RPC Layer**: tRPC procedures for client-server communication
- **AI Agents**: Specialized agents for planning, execution, and testing
- **Database**: PostgreSQL with Drizzle ORM for data persistence
- **Authentication**: Better Auth for user management

### Module Boundaries
- `apps/extension`: Core extension logic and webview
- `packages/ui`: Shared React components
- `packages/db`: Database schema and client
- `packages/auth`: Authentication utilities
- `packages/api`: API routes and business logic
- `packages/webview-rpc`: RPC communication layer

### Data Flow
1. User interacts with VSCode extension
2. Extension activates AI agents for analysis
3. Agents communicate via RPC with webview UI
4. UI displays results and accepts user input
5. Data persisted to PostgreSQL database
6. Authentication handled via Better Auth

### State Management
- React hooks for component state
- XState machines for complex UI flows (e.g., file test machines)
- Database transactions for data consistency

### Code Examples
```typescript
// Extension entry point
export function activate(context: vscode.ExtensionContext) {
  // Initialize services and UI
}

// RPC router example
export const statusRouter = router({
  cypress: procedure.input(z.void()).query(({ ctx }) => {
    // Status logic
  })
});

// AI agent usage
const agent = new TestingAgent();
await agent.analyzeCodebase(files);
```

### Usage Patterns
- Extension uses Effect library for functional programming
- Zod schemas for runtime validation
- Vector embeddings for semantic code search
- Turbo for monorepo build orchestration

### Test Implications
- Unit tests for individual modules
- Integration tests for RPC communication
- E2E tests for full extension workflows
- Database integration tests for data persistence
- AI agent tests with mocked responses

### Edge Cases
- Network failures in AI API calls
- Database connection issues
- VSCode extension activation failures
- Large codebase analysis timeouts

### Related Patterns
- See 'Module Boundaries' for detailed responsibilities
- Links to 'Data Flow' for specific interactions
- 'AI Agent Architecture' for testing agent details

## Examples

### Example

```typescript
export function activate(context: vscode.ExtensionContext) { ... }
```

### Example

```typescript
export const conversation = pgTable("conversation", { ... });
```

### Example

```typescript
const agent = new TestingAgent();
```


## Source Files

- `apps/extension/src/extension.ts`
- `packages/db/src/schema.ts`
- `apps/extension/src/services/ai-agent/agent.ts`
