---
category: "data-flow"
title: "Data Flow and State Management Patterns"
sourceFiles:
  - apps/extension/src/rpc/routers/status.ts
  - apps/extension/src/webview/pages/dashboard/machines/file-test-machine.ts
  - apps/extension/src/services/config-service.ts
updatedAt: "2025-12-26"
---

Data flows through the system via RPC calls, with state managed at multiple levels. Understanding these patterns is crucial for testing user journeys and data consistency.

### Context for Testing
Data flow testing validates that information moves correctly through the system. State management testing ensures UI and business logic remain consistent during interactions.

### Overview
The system uses tRPC for type-safe client-server communication, with React for UI state and XState for complex state machines. Data persists in PostgreSQL with Drizzle ORM.

### Request/Response Cycles

**RPC Communication**
- Client: Webview components use `useRpc` hook
- Protocol: tRPC with Zod validation
- Server: Procedure handlers in router files
- Transport: VSCode message passing

**Database Operations**
- Client: Drizzle ORM for type-safe queries
- Connection: Pooled PostgreSQL connections
- Transactions: Used for data consistency
- Migrations: Schema versioning with Drizzle

### State Management Patterns

**Component State**
- React hooks (`useState`, `useEffect`)
- Local component state for UI interactions

**Application State**
- XState machines for complex workflows
- Example: File test machine, changeset chat machine
- State persistence in database

**Global State**
- Auth context for user sessions
- Configuration service for settings

### Code Examples
```typescript
// RPC client usage
const { data } = useRpc('status.cypress').query();

// Procedure handler
cypress: procedure.input(z.void()).query(async ({ ctx }) => {
  return ctx.db.query.conversation.findMany();
});

// State machine
const machine = setup({
  types: {} as {
    context: FileTestContext;
    events: FileTestEvents;
  }
}).createMachine({
  // states and transitions
});
```

### Usage Patterns
- Queries for read operations
- Mutations for write operations
- Subscriptions for real-time updates (if any)
- Effect library for side effects

### Test Implications
- Mock RPC calls in component tests
- Test state machine transitions
- Validate data transformations in procedures
- Integration tests for full request cycles
- Database state tests with cleanup

### Edge Cases
- Network timeouts in RPC calls
- Race conditions in state updates
- Database constraint violations
- State machine deadlock scenarios

### Related Patterns
- See 'API Contracts' for procedure definitions
- Links to 'Database Patterns' for persistence
- 'Component Lifecycle' for state patterns

## Examples

### Example

```typescript
const { data } = useRpc('status.cypress').query();
```

### Example

```typescript
cypress: procedure.input(z.void()).query(async ({ ctx }) => { ... });
```

### Example

```typescript
const machine = setup({ ... }).createMachine({ ... });
```


## Source Files

- `apps/extension/src/rpc/routers/status.ts`
- `apps/extension/src/webview/pages/dashboard/machines/file-test-machine.ts`
- `apps/extension/src/services/config-service.ts`
