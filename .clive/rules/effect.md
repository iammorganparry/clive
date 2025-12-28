# Effect Testing Standards

All tests involving Effect-TS code MUST use `@effect/vitest` for proper effect execution and testing.

## Rules

- **Always use `it.effect()` for Effect-based tests** - Never use regular `it()` or `it.async()` for code that uses Effect
- **Use `Effect.gen()` with generators** - All test logic should be wrapped in `Effect.gen(function* () { ... })`
- **Use `Effect.sync()` for synchronous setup** - Wrap mock setup, assertions, and side effects in `Effect.sync()`
- **Use `Effect.promise()` for async operations** - Execute async tool calls with `Effect.promise(() => ...)`
- **Follow existing test patterns** - Maintain consistency with established test files

## Examples

### ✅ Good - Using @effect/vitest

```typescript
import { it } from "@effect/vitest";
import { Effect } from "effect";

it.effect("should handle operation successfully", () =>
  Effect.gen(function* () {
    // Setup
    yield* Effect.sync(() => {
      approvalRegistry.add("test-1");
      mockFs.stat.mockResolvedValue({ type: 1 });
    });

    // Create tool
    const tool = yield* Effect.sync(() => createWriteTestFileTool(approvalRegistry));

    // Execute
    const result = yield* Effect.promise(() => executeTool(tool, input));

    // Assert
    yield* Effect.sync(() => {
      expect(result.success).toBe(true);
      expect(mockFs.writeFile).toHaveBeenCalled();
    });
  }),
);
```

### ❌ Bad - Using regular async/await

```typescript
import { it } from "vitest";

it("should handle operation successfully", async () => {
  // DON'T use regular async/await for Effect-based code
  approvalRegistry.add("test-1");
  const tool = createWriteTestFileTool(approvalRegistry);
  const result = await executeTool(tool, input);
  expect(result.success).toBe(true);
});
```

## Pattern Structure

Every Effect test should follow this structure:

```typescript
it.effect("test description", () =>
  Effect.gen(function* () {
    // 1. Setup - wrap in Effect.sync()
    yield* Effect.sync(() => {
      // Mock configuration
      // Test data setup
    });

    // 2. Create instances - wrap in Effect.sync()
    const instance = yield* Effect.sync(() => createInstance(params));

    // 3. Execute - use Effect.promise() for async operations
    const result = yield* Effect.promise(() => asyncOperation());

    // 4. Assert - wrap in Effect.sync()
    yield* Effect.sync(() => {
      expect(result).toBe(expected);
    });
  }),
);
```

## Reference Files

- `apps/extension/src/services/ai-agent/tools/__tests__/write-test-file.spec.ts` - Comprehensive example of Effect testing patterns
- `apps/extension/src/services/ai-agent/tools/__tests__/replace-in-file.spec.ts` - Additional Effect test examples

## Why @effect/vitest?

- **Proper Effect execution** - Ensures Effects are properly run within the test runtime
- **Error handling** - Correctly handles Effect failures and errors
- **Type safety** - Maintains Effect type inference throughout tests
- **Consistency** - Aligns with the codebase's declarative Effect patterns

## Mock Setup

When mocking Effect services, use the established pattern:

```typescript
let currentMockInstance: unknown = null;

vi.mock("../../../service-path", async () => {
  const { Effect, Layer } = await import("effect");
  
  const ServiceMock = {
    pipe: () => Effect.sync(() => currentMockInstance),
    Default: Layer.empty,
  };
  
  return { ServiceMock };
});
```

Then in tests:

```typescript
yield* Effect.sync(() => { 
  currentMockInstance = mockImplementation; 
});
```

## Integration with Vitest

- Import `it` from `@effect/vitest`, not from `vitest`
- Other vitest utilities (describe, beforeEach, expect, vi) come from `vitest` as normal
- Effect mocking requires special consideration - see Mock Setup section above

