---
category: "code-activity"
title: "Hot Code Areas - Recent Modifications"
sourceFiles:
  - git log output
updatedAt: "2025-12-26"
---

This knowledge article documents the most actively modified files in the codebase over the last 3 and 1 months, indicating areas of hot code that are currently being developed or maintained. Focusing testing efforts on these areas ensures that tests cover the most relevant and evolving parts of the system, avoiding wasted effort on stale code.

### Context for Testing
Hot code areas are where bugs are most likely to be introduced due to frequent changes. Testing agents should prioritize writing and maintaining tests for these files, as they represent the core active functionality. Conversely, areas with no recent commits can be deprioritized unless they contain critical dependencies.

### Overview of Activity
The repository is a monorepo with workspaces including `apps/extension`, `packages/ui`, `packages/db`, `packages/auth`, and `packages/api`. The majority of recent activity is concentrated in the `apps/extension` workspace, particularly around AI agent services, RPC routers, webview components, and configuration management. This suggests an extension-based application (likely VS Code or similar) with AI-powered features.

### Top Modified Files (Last 3 Months)
Based on git log analysis:
- `yarn.lock`: 22 modifications (dependency updates)
- `apps/extension/src/constants.ts`: 22 modifications
- `apps/extension/src/views/clive-view-provider.ts`: 21 modifications
- `apps/extension/src/services/ai-agent/prompts.ts`: 21 modifications
- `apps/extension/src/extension.ts`: 19 modifications
- `apps/extension/src/package.json`: 19 modifications
- And many others in AI agent services, RPC routers, and webview components.

### Top Modified Files (Last 1 Month)
Similar pattern, with even higher activity in some files like `apps/extension/src/constants.ts` (22 mods).

### Usage Patterns
- Frequent updates to AI agent prompts and tools suggest iterative development of AI features.
- RPC routers and webview components indicate active UI and API development.
- Database schema changes (packages/db/src/schema.ts) show evolving data models.

### Test Implications
- Prioritize unit and integration tests for modified AI agent services (e.g., testing-agent.ts, planning-agent.ts).
- Ensure UI components in webview are covered by component tests, especially those in dashboard and changeset-chat.
- Monitor database schema changes for potential migration testing needs.
- RPC endpoints should have API contract tests to ensure backward compatibility.

### Edge Cases
- Rapid changes to constants.ts may introduce hardcoded values that break in different environments.
- AI prompt modifications could lead to unexpected behavior if not validated.

### Related Patterns
- See 'Active Development Areas' for broader context.
- Relates to 'System Architecture' for how these components fit together.

## Examples

### Example

```typescript
Top 3 months: yarn.lock (22), apps/extension/src/constants.ts (22), apps/extension/src/views/clive-view-provider.ts (21)
```

### Example

```typescript
Top 1 month: apps/extension/src/constants.ts (22), yarn.lock (21), apps/extension/src/views/clive-view-provider.ts (21)
```


## Source Files

- `git log output`
