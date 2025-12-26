---
category: "test-frameworks"
title: "Vitest Testing Framework"
sourceFiles:
  - apps/extension/vitest.config.ts
  - apps/extension/src/__mocks__/vscode.ts
  - apps/extension/src/test/setup.ts
updatedAt: "2025-12-26"
---

Vitest serves as the primary testing framework across the monorepo, configured for unit and integration testing with jsdom environment for React components.

### Context for Testing
Vitest provides fast, type-safe testing with native ESM support. Understanding its configuration helps write effective tests and debug issues.

### Overview
Configured with jsdom for browser-like testing, globals enabled for describe/it/expect, and custom aliases for mocking. Setup files configure the test environment.

### Configuration Details
- **Environment**: jsdom for DOM manipulation
- **Globals**: describe, it, expect available without imports
- **Setup**: Minimal setup file for jsdom configuration
- **Aliases**: @/ -> src/, vscode -> mock implementation
- **Include**: src/**/*.spec.ts
- **Exclude**: node_modules, dist, out, src/test/**

### Test Patterns
- File naming: *.spec.ts
- Location: __tests__/ directories or alongside implementation
- Mocking: vi from vitest for spies/stubs
- Async testing: native async/await support

### Code Examples
```typescript
import { describe, it, expect, vi } from "vitest";

describe("ConfigService", () => {
  it("should load configuration", async () => {
    const mockVSCode = { /* mock */ };
    const service = new ConfigService(mockVSCode);
    
    const config = await service.load();
    expect(config.apiKey).toBeDefined();
  });
});
```

### Usage Patterns
- Mock external dependencies (VSCode, databases)
- Test utilities for setup/teardown
- Snapshot testing for UI components
- Integration tests with real services

### Test Implications
- Ensure jsdom for React component tests
- Use vi.mock() for module mocking
- Test file placement affects import paths
- Environment variables for configuration

### Edge Cases
- jsdom vs node environment differences
- Mock cleanup between tests
- Async operation timing
- Module resolution in monorepo

### Related Patterns
- See 'Test Execution' for running commands
- Links to 'Mock Strategies' for mocking patterns

## Examples

### Example

```typescript
import { describe, it, expect, vi } from "vitest";
```

### Example

```typescript
test: { environment: "jsdom", globals: true }
```

### Example

```typescript
vi.mock("vscode", () => mockVSCode);
```


## Source Files

- `apps/extension/vitest.config.ts`
- `apps/extension/src/__mocks__/vscode.ts`
- `apps/extension/src/test/setup.ts`
