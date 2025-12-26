---
category: "test-execution"
title: "Unit Tests - Extension Package"
sourceFiles:
  - apps/extension/vitest.config.ts
  - apps/extension/package.json
  - git log for vitest.config.ts
updatedAt: "2025-12-26"
---

Configuration and execution patterns for unit tests in the VSCode extension package. This workspace handles the core extension logic, AI agents, and webview UI.

### Framework
Vitest (version implied 1.x based on config)

### Command
`yarn test:unit` or `vitest run`

### Test Patterns
- Include: `src/**/*.spec.ts`
- Exclude: `node_modules`, `dist`, `out`, `src/test/**`

### Configuration
File: `apps/extension/vitest.config.ts`
Environment: jsdom (for React components)
Setup: `./src/test/setup.ts`
Aliases: `@/` -> `src/`, `vscode` -> mock

### Workspace Context
Package: apps/extension
Runs independently from other packages
Focused on extension-specific logic and UI

### Notes
- Uses jsdom for browser-like testing of webview components
- VSCode API mocked via alias
- Setup file configures global test utilities
- Active development with 3 config modifications in 6 months

### Test Types Covered
- Unit tests for services (AI agent, config, indexing)
- Component tests for React webview UI
- RPC procedure tests
- Utility function tests

### Dependencies
- Requires Node.js environment
- No external services for unit tests
- Mocks VSCode APIs

### Special Notes
- Build output in `out/` excluded from tests
- TypeScript compilation checked separately
- Integration with Turbo for monorepo orchestration

## Examples

### Example

```typescript
import { describe, it, expect } from "vitest";
```

### Example

```typescript
test: { globals: true, environment: "jsdom", setupFiles: ["./src/test/setup.ts"] }
```

### Example

```typescript
vitest run src/**/*.spec.ts
```


## Source Files

- `apps/extension/vitest.config.ts`
- `apps/extension/package.json`
- `git log for vitest.config.ts`
