---
category: "code-activity"
title: "Active Development Areas in Clive Codebase"
sourceFiles:
  - git log output
  - import analysis
updatedAt: "2025-12-26"
---

This document identifies the most actively modified files and areas in the Clive codebase, based on git commit history over the last 3 months. This helps focus testing efforts on hot code paths that are currently under development or frequently changed.

### Hot Code Areas (Prioritize for Testing)
- **Extension App (apps/extension/)**: Core VSCode extension functionality, including AI agents, webview, RPC routers, and services. Heavily modified, indicating active feature development.
- **AI Agent Services**: Testing agent, planning agent, execution agent, prompts - core AI functionality.
- **Database Schema (packages/db/src/schema.ts)**: Data models and validation schemas.
- **UI Components (packages/ui/)**: Shared UI library components.
- **Webview Components**: Dashboard, changeset chat, user interface elements.

### Top 50 Most Modified Files (Last 3 Months)
1. yarn.lock (65 commits - dependency updates)
2. apps/extension/src/constants.ts (22)
3. apps/extension/src/views/clive-view-provider.ts (21)
4. apps/extension/src/services/ai-agent/prompts.ts (21)
5. apps/extension/src/extension.ts (19)
6. apps/extension/package.json (19)
7. packages/ui/package.json (17)
8. apps/extension/src/services/ai-agent/testing-agent.ts (16)
9. apps/extension/src/rpc/routers/agents.ts (15)
10. apps/extension/src/webview/App.tsx (14)
... (truncated for brevity)

### Import Dependencies Analysis
Most imported modules indicate core infrastructure:
- vitest (781 imports - testing framework)
- zod/v3, zod/v4 (701 - validation)
- @azure/msal-common/browser (314 - Azure auth)
- Internal core modules (errors.js, util.js, schemas.js)

### Testing Implications
- Focus unit tests on extension app components, especially AI agent services and RPC routers
- Prioritize integration tests for database interactions and auth flows
- Monitor changes in hot files for regression testing
- Test coverage should be high in modified areas

### Cold Code Areas
- No significant cold code identified in recent history
- All major areas show recent activity
- Legacy frameworks: None apparent - codebase uses modern stack (Vitest, Drizzle, tRPC)
## Source Files

- `git log output`
- `import analysis`
