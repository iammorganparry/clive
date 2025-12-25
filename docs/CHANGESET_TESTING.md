# Changeset-Based Testing

## Overview

This document describes the evolution from per-file test generation to a changeset-based approach that analyzes all changed files together.

## Design Rationale

### Problem with Per-File Approach

The original implementation generated test plans for individual files independently. This approach had several limitations:

1. **Missed Integration Opportunities**: Files in a feature often contribute to the same business logic. Testing them individually misses opportunities for integration tests that better reflect real-world usage.

2. **Example Scenario**: A feature might include:

   - A new API endpoint (`/api/auth/login`)
   - A button component (`LoginButton.tsx`)
   - A context provider (`AuthContext.tsx`)

   Testing these individually would result in isolated unit tests. However, an integration test covering the full user flow (click button → context updates → API call) would be more valuable.

3. **Fragmented Conversations**: Each file had its own conversation thread, making it difficult to discuss cross-file relationships and test strategies.

### Branch-Based Conversation Identity

Conversations are now linked to branches rather than individual files:

- **Persistent Context**: As a feature evolves on a branch, the conversation persists, allowing iterative refinement of test plans.
- **Natural Workflow**: Developers work on branches, make commits, and iterate. The conversation follows this natural flow.
- **Changeset Definition**: A changeset is defined as `branchName` + `baseBranch` (e.g., `feature/checkout` compared to `main`).

## Phased Implementation

### Phase 1: Single CTA + All Files ✅

**Goal**: Replace per-file test buttons with a single "Generate Tests" CTA that sends all changed files to the agent at once.

**Changes**:

- Add `changesetChat` route
- Create minimal changeset chat page
- Update dashboard with single CTA
- Simplify file display components

**What Works**:

- User sees all changed files on dashboard
- Single button generates tests for entire changeset
- Navigates to chat view with streaming output
- Agent analyzes all files together

**What's Deferred**:

- Conversations not persisted to database yet
- No auto-redirect (each click starts fresh)
- Old file-based conversation code still exists

### Phase 2: Database Persistence (Planned)

**Goal**: Persist conversations linked to branches in the database.

**Changes**:

- Update database schema (replace `sourceFile` with `branchName`, `baseBranch`, `sourceFiles`)
- Update API endpoints for branch-based lookups
- Add auto-redirect logic (if conversation exists, go to chat)

### Phase 3: Cleanup (Planned)

**Goal**: Remove deprecated file-based code paths.

**Changes**:

- Remove file-based conversation service methods
- Remove file-test-actors context
- Remove file-test-machine
- Finalize database migration

## Architecture Decisions

### Navigation Flow

1. **Dashboard View**: Shows branch changes with file list and single CTA
2. **CTA Click**: Navigates to changeset chat view
3. **Chat View**: Streams tool calls, reasoning, proposals in real-time
4. **Future**: Once conversation exists, dashboard auto-redirects to chat (Phase 2)

### State Management

- **Phase 1**: Uses existing `agents.planTests` RPC subscription
- **Future**: Will create dedicated changeset state machine (Phase 2)

### Route Parameters

- `files`: JSON-encoded array of file paths
- `branchName`: Current branch name
- `baseBranch`: Base branch for comparison (future)

## Future Considerations

### Changeset Detection

When should we detect that a changeset has significantly changed?

- **Option 1**: Compare file list hash (if files change, offer to re-analyze)
- **Option 2**: Compare commit range (if base branch changes, detect diff)
- **Option 3**: User-initiated only (always allow "start fresh")

### Test Granularity Recommendations

The agent should recommend appropriate test granularity:

- **Unit tests**: For isolated utilities, pure functions
- **Integration tests**: For components + context + API interactions
- **E2E tests**: For complete user flows across multiple files

### Multi-Branch Support

How should we handle:

- Switching between branches?
- Multiple active conversations?
- Branch comparison changes (rebased on latest main)?

## Related Files

- `apps/extension/src/webview/pages/changeset-chat/` - Chat page for changeset analysis
- `apps/extension/src/webview/pages/dashboard/components/branch-changes.tsx` - Dashboard component
- `apps/extension/src/rpc/routers/agents.ts` - RPC endpoint for test planning
- `apps/extension/src/services/ai-agent/testing-agent.ts` - Agent implementation
