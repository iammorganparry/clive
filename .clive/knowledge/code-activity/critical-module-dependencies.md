---
category: "code-activity"
title: "Critical Module Dependencies"
sourceFiles:
  - grep output from import analysis
updatedAt: "2025-12-26"
---

This article identifies the most frequently imported modules across the codebase, highlighting core dependencies that are actively used. These represent the foundational libraries and internal packages that underpin the system's functionality, making them critical for testing to ensure stability.

### Context for Testing
Frequently imported modules are likely to be core infrastructure. Tests should verify that these imports work correctly and that changes to these modules don't break dependent code. Mocks or stubs may be needed for external dependencies like VSCode or Effect.

### Overview
The codebase heavily relies on React for UI components, Effect for functional programming and effects, Zod for schema validation, and VSCode APIs for extension functionality. Internal packages like @clive/ui, @clive/webview-rpc, and @clive/auth are also heavily imported, indicating a modular monorepo structure.

### Top Imported Modules
- React: 29 * as react, 27 type React, 15 * as React (core UI framework)
- cn from ./lib/utils: 22 imports (utility for class names, likely tailwind)
- Effect: 19, 13, 11 (functional programming library)
- z from zod: 18 (schema validation)
- vscode: 18, 11 (VSCode extension API)
- @clive/ui/button: 9 (shared UI component)
- createRouter from @clive/webview-rpc: 8 (RPC communication)
- auth from @clive/auth: 8 (authentication)

### Usage Patterns
- Effect is used for managing side effects and runtime, common in functional programming.
- Zod schemas are used for type-safe validation, likely in API contracts and data models.
- VSCode APIs are imported in extension code for IDE integration.
- Internal packages like @clive/ui provide reusable components.

### Test Implications
- Unit tests should mock external dependencies like vscode and Effect to isolate component logic.
- Integration tests for UI components should include @clive/ui imports.
- Validate Zod schemas in tests to ensure data integrity.
- RPC router tests should cover @clive/webview-rpc functionality.

### Edge Cases
- Version mismatches in Effect or Zod could break type safety.
- VSCode API changes in updates might affect extension behavior.

### Related Patterns
- Links to 'System Architecture' for how these modules fit into the overall design.
- See 'API Contracts' for Zod usage in endpoints.

## Examples

### Example

```typescript
import { Effect } from "effect";
```

### Example

```typescript
import { z } from "zod";
```

### Example

```typescript
import { createRouter } from "@clive/webview-rpc";
```


## Source Files

- `grep output from import analysis`
