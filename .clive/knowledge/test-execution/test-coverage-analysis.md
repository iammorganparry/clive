---
category: "test-execution"
title: "Test Coverage Analysis"
sourceFiles:
  - git log output for test files
  - find command for test files
updatedAt: "2025-12-26"
---

Analysis of existing test files and their relation to hot code areas. This helps identify coverage gaps where frequently modified code lacks corresponding tests.

### Context for Testing
Hot code areas with low test coverage are high-risk for regressions. Testing agents should prioritize adding tests to these areas, while maintaining existing test suites for covered code.

### Overview
The codebase has 21 test files, with recent activity in several spec files. However, many hot code files (modified 10+ times in 3 months) lack dedicated tests, indicating potential coverage gaps.

### Test File Inventory
- Total test files: 21
- Active test files (modified in 6 months): 10
- Top active: codebase-indexing-service.spec.ts (8 mods), config-service.spec.ts (5 mods)

### Coverage Gaps in Hot Code
Hot files without apparent tests:
- apps/extension/src/constants.ts (22 mods) - No test file
- apps/extension/src/extension.ts (19 mods) - No test file  
- apps/extension/src/services/ai-agent/prompts.ts (21 mods) - No test file
- apps/extension/src/views/clive-view-provider.ts (21 mods) - No test file
- apps/extension/src/webview/App.tsx (14 mods) - No component test
- packages/db/src/schema.ts (10 mods) - Schema validation tests exist but limited

### Usage Patterns
- Test files follow .spec.ts convention
- Located alongside implementation files in __tests__/ directories
- Recent activity suggests ongoing test maintenance

### Test Implications
- Add unit tests for constants.ts to validate configuration values
- Integration tests for extension.ts entry point
- Component tests for App.tsx and webview components
- Unit tests for AI agent prompts to ensure prompt engineering works
- Schema migration tests for database changes

### Edge Cases
- Configuration changes in constants.ts could break without validation
- AI prompt modifications may introduce hallucinations or incorrect behavior
- UI changes without tests risk visual regressions

### Related Patterns
- See 'Hot Code Areas' for full list of active files
- Links to 'Test Frameworks' for execution patterns

## Examples

### Example

```typescript
apps/extension/src/services/__tests__/codebase-indexing-service.spec.ts
```

### Example

```typescript
apps/extension/src/services/__tests__/config-service.spec.ts
```

### Example

```typescript
packages/api/src/services/__tests__/conversation-repository.spec.ts
```


## Source Files

- `git log output for test files`
- `find command for test files`
