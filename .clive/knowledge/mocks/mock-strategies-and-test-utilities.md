---
category: "mocks"
title: "Mock Strategies and Test Utilities"
sourceFiles:
  - apps/extension/src/__mocks__/vscode.ts
  - packages/api/src/__mocks__/drizzle.mock.ts
  - apps/extension/src/services/__tests__/test-layer-factory.ts
updatedAt: "2025-12-26"
---

Comprehensive mocking strategies for external dependencies and test utilities for common testing scenarios. Mocks isolate units under test and provide deterministic behavior.

### Context for Testing
Proper mocking is essential for unit tests to remain fast and reliable. Test utilities reduce boilerplate and ensure consistent test setup across the codebase.

### Overview
The codebase uses Vitest's vi.mock() for module mocking, with custom mock implementations for VSCode API and database connections. Test utilities provide common fixtures and helpers.

### Mock Categories

**External APIs**
- VSCode API: Comprehensive mock with filesystem operations
- Database: Drizzle mock for query testing
- AI Services: Mocked LLM responses

**Internal Dependencies**
- Service mocks for complex dependencies
- Component mocks for UI testing
- RPC mocks for API testing

### Key Mocks

**VSCode API Mock**
- File system operations (read/write/stat)
- Workspace folder management
- UI interactions (messages, terminals)
- URI handling

**Database Mock**
- Query builders and executors
- Transaction handling
- Schema validation

### Code Examples
```typescript
// VSCode mock usage
vi.mock("vscode", () => ({
  workspace: {
    findFiles: vi.fn().mockResolvedValue([]),
    fs: { readFile: vi.fn() }
  },
  window: {
    showInformationMessage: vi.fn()
  }
}));

// Test utility
const createMockVSCode = () => ({
  workspace: { /* mock implementation */ },
  window: { /* mock implementation */ }
});

describe("MyService", () => {
  it("uses workspace", () => {
    const vscode = createMockVSCode();
    const service = new MyService(vscode);
    // test
  });
});
```

### Usage Patterns
- Mock at module level for consistent behavior
- Factory functions for reusable mocks
- Partial mocks for testing specific functionality
- Cleanup after each test

### Test Implications
- Mock complex dependencies to focus on business logic
- Use real implementations where safe (filesystem in mocks)
- Test mock interactions to validate contracts
- Maintain mocks as dependencies change

### Edge Cases
- Mock state persistence between tests
- Deep mocking vs shallow mocking
- Mock return value timing (sync vs async)
- Circular dependency mocking

### Related Patterns
- See 'Test Frameworks' for Vitest configuration
- Links to 'Fixtures' for test data builders

## Examples

### Example

```typescript
vi.mock("vscode", () => ({ ... }));
```

### Example

```typescript
const createMockVSCode = () => ({ ... });
```

### Example

```typescript
vi.mock("@clive/db", () => mockDb);
```


## Source Files

- `apps/extension/src/__mocks__/vscode.ts`
- `packages/api/src/__mocks__/drizzle.mock.ts`
- `apps/extension/src/services/__tests__/test-layer-factory.ts`
