---
category: "core-components"
title: "RPC Communication System"
sourceFiles:
  - apps/extension/src/rpc/routers/status.ts
  - apps/extension/src/rpc/routers/auth.ts
  - packages/webview-rpc/src/types.ts
updatedAt: "2025-12-26"
---

The RPC system provides type-safe client-server communication using tRPC and Zod validation. It defines contracts for all API interactions between the webview UI and extension backend services.

### Context for Testing
RPC procedures are the primary API contracts. Tests must validate input validation, error handling, and data transformation in procedures. Contract testing ensures API compatibility.

### Overview
Built on tRPC with Zod schemas, the RPC system defines routers for different domains (status, auth, config, etc.). Procedures use Effect for error handling and provide type-safe communication.

### Component Interfaces
- **Router**: Collection of procedures (queries/mutations)
- **Procedure**: Individual API endpoint with input/output schemas
- **Context**: Request context with database, user, and services

### Key Responsibilities
- Type-safe API definitions
- Input validation with Zod
- Error handling and serialization
- Database operations
- Authentication middleware

### Code Examples
```typescript
// Router definition
export const statusRouter = router({
  cypress: procedure
    .input(z.void())
    .query(async ({ ctx }) => {
      const result = await ctx.db.query.conversation.findMany();
      return result;
    }),

  branchChanges: procedure
    .input(z.object({ branch: z.string() }))
    .query(async ({ ctx }) => {
      // implementation
    })
});

// Client usage
const { data } = useRpc('status.cypress').query();
```

### Usage Patterns
- Queries for read operations
- Mutations for write operations
- Void inputs for simple status checks
- Object inputs for parameterized requests
- Context injection for dependencies

### Test Implications
- Unit tests for procedure logic with mocked context
- Integration tests for full RPC calls
- Schema validation tests
- Error response testing
- Authentication guard testing

### Edge Cases
- Invalid input validation
- Database errors in procedures
- Context dependency failures
- Network serialization issues
- Type mismatches between client/server

### Related Patterns
- See 'API Contracts' for detailed procedure definitions
- Links to 'Data Flow' for request cycles
- 'Error Handling' for procedure errors

## Examples

### Example

```typescript
export const statusRouter = router({ ... });
```

### Example

```typescript
cypress: procedure.input(z.void()).query(async ({ ctx }) => { ... });
```

### Example

```typescript
const { data } = useRpc('status.cypress').query();
```


## Source Files

- `apps/extension/src/rpc/routers/status.ts`
- `apps/extension/src/rpc/routers/auth.ts`
- `packages/webview-rpc/src/types.ts`
