# Task Template

This template provides a complete structure for creating user story-based tasks with acceptance criteria and Definition of Done.

## Basic Task Structure

```markdown
### Task: [User-Facing Capability]

**User Story:**
As a [type of user]
I want [capability]
So that [benefit/value]

**Acceptance Criteria:**
1. [Specific, testable criterion]
2. [Specific, testable criterion]
3. [Specific, testable criterion]

**Definition of Done:**
- [ ] All acceptance criteria met and verified
- [ ] Unit tests written and passing (where applicable)
- [ ] Integration tests written and passing (where applicable)
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] No linting errors
- [ ] No type errors
- [ ] Build succeeds

**Technical Notes:**
- **Files affected:** [list file paths]
- **Existing patterns:** [reference similar implementations with file:line]
- **Code example:** [snippet showing similar pattern from codebase]
- **Recommended skill:** [feature/bugfix/refactor with justification]
- **Dependencies:** [other tasks, services, utilities]
- **Complexity:** [1-10 with reasoning based on codebase analysis]
- **Testing strategy:** [based on existing test patterns found in codebase]

**Out of Scope:**
[What this task explicitly does NOT include]

**Estimated Effort:** [e.g., "4-6 hours" - OPTIONAL]
```

## Complete Example: Feature Task

```markdown
### Task: User can authenticate with Google OAuth

**User Story:**
As a user
I want to log in using my Google account
So that I don't need to remember another password

**Acceptance Criteria:**
1. "Sign in with Google" button appears on login page
2. Clicking button redirects to Google OAuth flow
3. After successful auth, user is logged into system
4. Error message shows if OAuth fails
5. User profile populated from Google data
6. User session persists across page refreshes

**Definition of Done:**
- [ ] All acceptance criteria verified working
- [ ] Unit tests for OAuth token validation passing
- [ ] Integration test for full OAuth flow passing
- [ ] Error scenarios tested (invalid token, network failure)
- [ ] Session management works correctly
- [ ] Build succeeds with no type errors
- [ ] No new linting warnings

**Technical Notes:**
- **Files affected:**
  - src/services/auth-service.ts (new OAuth provider)
  - src/components/LoginButton.tsx (UI component)
  - src/views/login-view.ts (webview integration)

- **Existing patterns:**
  - Effect-TS service layers (src/services/config-service.ts:120-145)
  - Service layer composition (src/services/layer-factory.ts:45-89)
  - Similar OAuth flow in src/services/github-oauth.ts:34-67

- **Code example to follow:**
  ```typescript
  // Pattern from src/services/github-oauth.ts:34-67
  pipe(
    Effect.promise(() => initiateOAuthFlow()),
    Effect.flatMap((token) => validateToken(token)),
    Effect.map((user) => createSession(user)),
    Runtime.runPromise(Runtime.defaultRuntime)
  )
  ```

- **Recommended skill:** feature (new user-facing authentication capability, follows pattern in src/services/)

- **Dependencies:**
  - ApiKeyService (src/services/api-key-service.ts)
  - SecretStorage (src/services/secret-storage.ts)
  - VSCodeService (src/services/vscode-service.ts)

- **Complexity:** 6/10
  - OAuth integration is well-documented (+2 points)
  - Effect-TS patterns are established in codebase (-1 point)
  - Session management adds complexity (+3 points)
  - Similar implementation exists to reference (-2 points)

- **Testing strategy:**
  - Unit tests with mocked OAuth provider (pattern: src/services/__tests__/api-key-service.test.ts)
  - Integration test covering full OAuth flow
  - Manual verification in Extension Development Host

**Out of Scope:**
- Multi-factor authentication
- Remember me functionality
- Account linking for users with existing accounts
- SSO integration with other providers

**Estimated Effort:** 6-8 hours
```

## Complete Example: Bugfix Task

```markdown
### Task: Login no longer crashes when user ID not found

**User Story:**
As a user
I want to see a helpful error message when my user ID doesn't exist
So that I know what went wrong instead of seeing a crash

**Acceptance Criteria:**
1. Entering nonexistent user ID shows "User not found" error message
2. Error message is user-friendly (not technical stack trace)
3. User can retry login after seeing error
4. All existing valid login flows still work correctly
5. No console errors or crashes

**Definition of Done:**
- [ ] All acceptance criteria met and verified
- [ ] Regression test added to prevent bug from returning
- [ ] All existing tests still pass
- [ ] Root cause identified and documented
- [ ] Build succeeds
- [ ] No new linting errors

**Technical Notes:**
- **Files affected:**
  - src/services/user-service.ts (add null check)
  - src/services/__tests__/user-service.test.ts (regression test)

- **Root cause:** getUser() function accesses user.name without checking if user exists
  - File: src/services/user-service.ts:45
  - Current code: `return users.find(u => u.id === id).name;`
  - Issue: Crashes if find() returns undefined

- **Fix approach:**
  ```typescript
  // Add null check before accessing properties
  const user = users.find(u => u.id === id);
  if (!user) {
    throw new UserNotFoundError(id);
  }
  return user.name;
  ```

- **Existing pattern:** Similar error handling in src/services/auth-service.ts:89-95

- **Recommended skill:** bugfix (fixing broken behavior)

- **Dependencies:** None

- **Complexity:** 2/10 (simple null check, straightforward fix)

- **Testing strategy:**
  - Regression test: Verify UserNotFoundError thrown for invalid ID
  - Integration test: Verify error message shows in UI
  - Pattern: src/services/__tests__/auth-service.test.ts:120-135

**Out of Scope:**
- Improving the user lookup performance
- Adding user caching
- Refactoring the entire user service

**Estimated Effort:** 1-2 hours
```

## Complete Example: Refactor Task

```markdown
### Task: Extract duplicate validation logic into shared validator

**User Story:**
As a developer
I want validation logic centralized in a shared validator class
So that I don't have to maintain the same validation rules in multiple places

**Acceptance Criteria:**
1. All 3 instances of duplicate email validation use new EmailValidator
2. Validation behavior unchanged (all existing tests pass)
3. Code is more maintainable (single source of truth)
4. No performance degradation
5. Build succeeds with no type errors

**Definition of Done:**
- [ ] All acceptance criteria met
- [ ] All existing tests still pass
- [ ] No behavior changes introduced
- [ ] Code follows project patterns
- [ ] Build succeeds
- [ ] No linting errors

**Technical Notes:**
- **Files affected:**
  - src/validators/email-validator.ts (new shared validator)
  - src/services/user-service.ts (use shared validator)
  - src/services/registration-service.ts (use shared validator)
  - src/components/EmailInput.tsx (use shared validator)

- **Existing patterns:**
  - Similar validator pattern in src/validators/password-validator.ts
  - Export structure follows src/validators/index.ts

- **Code example to follow:**
  ```typescript
  // Pattern from src/validators/password-validator.ts
  export class EmailValidator {
    static validate(email: string): ValidationResult {
      // Centralized validation logic
    }
  }
  ```

- **Recommended skill:** refactor (improving code structure without changing behavior)

- **Dependencies:**
  - Must update all call sites that reference old validation
  - No external dependencies

- **Complexity:** 4/10
  - Straightforward extraction (+2 points)
  - Multiple call sites to update (+2 points)
  - Well-established pattern to follow (-1 point)

- **Testing strategy:**
  - All existing tests must pass unchanged
  - No new tests needed (behavior unchanged)
  - Verify no performance regression

**Out of Scope:**
- Adding new validation rules
- Refactoring other validators
- Improving error messages

**Estimated Effort:** 2-3 hours
```

## Minimal Task Example

For simple tasks, you can use a condensed format:

```markdown
### Task: Add "Clear All" button to filters panel

**User Story:**
As a user, I want a "Clear All" button to reset all filters, so that I can start a fresh search quickly.

**Acceptance Criteria:**
1. "Clear All" button appears in filters panel
2. Clicking button resets all filters to defaults
3. Search results update immediately after clearing

**Definition of Done:**
- [ ] Acceptance criteria met
- [ ] Tests passing
- [ ] Build succeeds

**Technical Notes:**
- Files: src/components/FilterPanel.tsx
- Pattern: Similar clear button in src/components/SearchBar.tsx:89
- Skill: feature
- Complexity: 2/10
```

## Guidelines for Using This Template

### When to Use Full Template
- Complex features requiring detailed planning
- Tasks that affect multiple files
- Tasks with significant technical decisions
- Tasks requiring specific testing strategies

### When to Use Minimal Template
- Simple, straightforward tasks
- Single-file changes
- Tasks with obvious implementation
- Low complexity (1-3 out of 10)

### Required Sections
These sections are ALWAYS required:
- User Story (or clear task title)
- Acceptance Criteria (3-7 criteria)
- Definition of Done
- Technical Notes (at minimum: files affected, skill recommendation)

### Optional Sections
- Out of Scope (useful for complex tasks)
- Estimated Effort (optional, helpful for planning)

## Integration with Planning Agent

The planning agent (`/apps/tui/commands/plan.md`) uses this template to generate tasks. It will:

1. Conduct 4-phase stakeholder interview
2. Research codebase to find existing patterns
3. Generate user stories with acceptance criteria
4. Populate technical notes with codebase research findings
5. Output tasks following this template structure

## Integration with Skills

The implementation skills (`feature.md`, `bugfix.md`, `refactor.md`) use tasks structured with this template:

1. **Phase 1**: Read acceptance criteria and DoD from task
2. **Phase 2**: Implement following technical notes patterns
3. **Phase 4**: Verify ALL acceptance criteria before marking complete

## Resources

- **User Story Guide**: [user-story-writing.md](../guides/user-story-writing.md)
- **Acceptance Criteria Guide**: [acceptance-criteria.md](../guides/acceptance-criteria.md)
- **Planning Agent**: [/apps/tui/commands/plan.md](../commands/plan.md)
- **Skills**: [/apps/tui/skills/](../skills/)
