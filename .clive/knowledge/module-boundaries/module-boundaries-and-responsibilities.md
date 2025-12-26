---
category: "module-boundaries"
title: "Module Boundaries and Responsibilities"
sourceFiles:
  - package.json (workspaces)
  - apps/extension/package.json
  - packages/*/package.json
updatedAt: "2025-12-26"
---

Clear delineation of module responsibilities in the monorepo architecture. Each package has specific concerns, enabling focused development and testing.

### Context for Testing
Module boundaries define test scopes. Unit tests stay within modules, while integration tests validate cross-module interactions. Understanding boundaries helps identify mock points and test doubles.

### Overview
The monorepo uses workspaces to separate concerns: extension logic, shared UI, data access, authentication, API, and communication layers. This separation allows independent development and deployment.

### Module Responsibilities

**apps/extension**
- VSCode extension lifecycle management
- AI agent orchestration
- Webview UI hosting
- Extension-specific services (config, git, indexing)

**packages/ui**
- Shared React components and utilities
- UI design system (buttons, forms, etc.)
- Reusable component patterns

**packages/db**
- Database schema definition (Drizzle)
- Data models and relationships
- Migration management

**packages/auth**
- Authentication logic (Better Auth integration)
- Session management
- User authorization

**packages/api**
- API route handlers
- Business logic for data operations
- tRPC procedure definitions

**packages/webview-rpc**
- Client-server communication protocol
- Type-safe RPC procedures
- Message serialization

**apps/dashboard**
- Web-based dashboard interface
- User management UI
- Analytics and reporting

### Boundary Crossings
- Extension communicates with API via RPC
- UI packages shared across extension and dashboard
- Auth package used by API and extension
- DB package provides data access to all

### Code Examples
```typescript
// packages/ui - shared component
export const Button = ({ children, ...props }) => (
  <button className={cn(buttonVariants())} {...props}>
    {children}
  </button>
);

// packages/db - schema export
export const db = drizzle(connection);
export * from './schema';

// apps/extension - module usage
import { Button } from '@clive/ui';
import { db } from '@clive/db';
```

### Usage Patterns
- Import from package names (e.g., @clive/ui)
- TypeScript for cross-package type safety
- Effect library used across modules for consistency

### Test Implications
- Mock external packages in unit tests
- Test package APIs as black boxes
- Integration tests for package interactions
- Shared fixtures for common test data

### Edge Cases
- Circular dependencies between packages
- Version mismatches in monorepo
- Package-specific environment requirements

### Related Patterns
- See 'System Architecture' for overall flow
- Links to 'API Contracts' for inter-module interfaces

## Examples

### Example

```typescript
import { Button } from "@clive/ui";
```

### Example

```typescript
export const db = drizzle(connection);
```

### Example

```typescript
export const statusRouter = router({ ... });
```


## Source Files

- `package.json (workspaces)`
- `apps/extension/package.json`
- `packages/*/package.json`
