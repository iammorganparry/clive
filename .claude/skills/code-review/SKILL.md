---
name: code-review
description: Code review a pull request
---

# Code Review

Review PRs and leave actionable comments with code suggestions for the author.

## Workflow

1. Fetch PR details and diff
2. Read CLAUDE.md for project conventions
3. Analyze changes against review criteria
4. Post comments with code suggestions

## Phase 1: Fetch PR

### Determine PR Number

**If PR number provided** (e.g., `/code-review 123`):
```bash
gh pr view 123 --json number,title,author,baseRefName,headRefName,url
```

**If no number** (use current branch):
```bash
gh pr view --json number,title,author,baseRefName,headRefName,url
```

If no PR found:
```
Error: No PR found. Create one first or specify PR number.
```

### Fetch the Diff

```bash
gh pr diff [PR_NUMBER]
```

### Get Changed Files List

```bash
gh pr view [PR_NUMBER] --json files --jq '.files[].path'
```

## Phase 2: Read Project Context

Read CLAUDE.md to understand project conventions:
```bash
Read file_path=[REPO_ROOT]/CLAUDE.md
```

Key patterns to extract:
- Effect-TS service patterns (required for backend)
- React guidelines (avoid useEffect)
- Testing requirements (Vitest, Playwright)
- Code style (Biome, DRY, KISS, YAGNI)

## Phase 3: Analyze Changes

Review each file against these criteria in order of priority.

### 3.1 Security Concerns

**Critical** - Block if found:
- SQL injection vulnerabilities
- Command injection (unescaped shell commands)
- XSS vulnerabilities (unescaped user input in JSX)
- Secrets/credentials in code
- Insecure authentication patterns
- Missing input validation at system boundaries

```typescript
// BAD: SQL injection
const query = `SELECT * FROM users WHERE id = ${userId}`;

// GOOD: Parameterized
const query = prisma.user.findUnique({ where: { id: userId } });
```

### 3.2 DRY Violations

**Major** - Flag repeated code:
- Same logic in 3+ places
- Copy-pasted functions with minor variations
- Repeated error handling patterns
- Duplicated API call structures

```typescript
// BAD: Repeated fetch logic
const getUsers = async () => {
  const res = await fetch('/api/users');
  if (!res.ok) throw new Error('Failed');
  return res.json();
};
const getPosts = async () => {
  const res = await fetch('/api/posts');
  if (!res.ok) throw new Error('Failed');
  return res.json();
};

// GOOD: Extracted utility
const fetchApi = async <T>(path: string): Promise<T> => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}`);
  return res.json();
};
```

### 3.3 Over-Complications

**Major** - Simplify if found:
- Premature abstractions (helper for one-time use)
- Over-engineered solutions (5 files for simple feature)
- Unnecessary indirection
- Complex conditional logic that could be simplified
- Feature flags for code that should just change
- Backwards-compatibility shims when code can just change

```typescript
// BAD: Over-abstracted
class UserFetcherFactory {
  createFetcher(type: string) {
    return new UserFetcher(this.config[type]);
  }
}

// GOOD: Direct and simple
const fetchUser = (id: string) => prisma.user.findUnique({ where: { id } });
```

### 3.4 CLAUDE.md Violations

**Major** - Enforce project conventions:

**Effect-TS (backend services MUST use):**
```typescript
// BAD: Raw async/await in service
async function createUser(data: UserInput) {
  try {
    return await prisma.user.create({ data });
  } catch (e) {
    throw new Error('Failed');
  }
}

// GOOD: Effect-TS pattern
export class UserService extends Effect.Service<UserService>()("UserService", {
  effect: Effect.gen(function* () {
    const prisma = yield* PrismaClient;
    return {
      create: (data: UserInput) => Effect.tryPromise({
        try: () => prisma.user.create({ data }),
        catch: (e) => new UserCreateError({ cause: e }),
      }),
    };
  }),
}) {}
```

**React (avoid useEffect):**
```typescript
// BAD: useEffect for data fetching
useEffect(() => {
  fetchData().then(setData);
}, []);

// GOOD: tRPC query
const { data } = trpc.users.list.useQuery();
```

**Dates (use dayjs):**
```typescript
// BAD: Native Date manipulation
new Date(timestamp).toLocaleDateString();

// GOOD: dayjs
dayjs(timestamp).format('YYYY-MM-DD');
```

### 3.5 Missing Test Coverage

**Major** - Flag untested code:

**Business logic without tests:**
- Services in `packages/services` need unit tests
- Complex utility functions need tests
- Error handling paths need coverage

**Frontend without Playwright tests:**
- New pages/routes need E2E tests
- User flows need coverage
- Form submissions need testing

**Inngest functions without integration tests:**
- Core workflows need integration tests
- Event handlers need testing

```typescript
// If adding: packages/services/src/billing/calculate-usage.ts
// Require: packages/services/src/__tests__/billing/calculate-usage.spec.ts
```

### 3.6 Style Violations

**Minor** - Note for consistency:
- Ternary expressions in JSX (be declarative)
- Inconsistent naming conventions
- Missing type annotations on public APIs
- Console.log statements (remove or use Effect.log)

### 3.7 Other Best Practices

**Minor to Major:**
- Missing error boundaries in React
- Unbounded queries (no pagination/limits)
- Missing loading/error states in UI
- Race conditions in async code
- Memory leaks (uncleared intervals/subscriptions)
- Hardcoded values that should be config

## Phase 4: Post Comments

### Comment Format

Use concise, actionable comments with code suggestions.

**For code suggestions:**
```bash
gh api repos/:owner/:repo/pulls/[PR_NUMBER]/comments \
  --method POST \
  -f body="$(cat <<'EOF'
**[Severity]**: [Category]

[1-2 sentence explanation]

\`\`\`suggestion
[suggested code fix]
\`\`\`
EOF
)"  \
  -f commit_id="[HEAD_SHA]" \
  -f path="[FILE_PATH]" \
  -f line=[LINE_NUMBER]
```

**Severity levels:**
- `Critical` - Security issues, data loss risks
- `Major` - DRY violations, over-complications, missing tests, CLAUDE.md violations
- `Minor` - Style issues, suggestions

**Example comments:**

```markdown
**Major**: DRY Violation

This fetch pattern is repeated 4 times. Extract to a shared utility.

\`\`\`suggestion
import { fetchApi } from '@trigify/utils';

const users = await fetchApi<User[]>('/api/users');
\`\`\`
```

```markdown
**Major**: Missing Effect-TS

Backend services must use Effect-TS per CLAUDE.md.

\`\`\`suggestion
export class PaymentService extends Effect.Service<PaymentService>()("PaymentService", {
  effect: Effect.gen(function* () {
    const stripe = yield* StripeClient;
    return {
      charge: (amount: number) => Effect.tryPromise({
        try: () => stripe.charges.create({ amount }),
        catch: (e) => new PaymentError({ cause: e }),
      }),
    };
  }),
}) {}
\`\`\`
```

```markdown
**Major**: Missing Tests

New business logic needs test coverage. Add tests for:
- Happy path
- Error cases
- Edge cases (empty input, max values)

Expected location: `packages/services/src/__tests__/billing/calculate-usage.spec.ts`
```

```markdown
**Critical**: SQL Injection

User input is interpolated directly into query. Use parameterized queries.

\`\`\`suggestion
const user = await prisma.user.findUnique({
  where: { id: userId }
});
\`\`\`
```

### Get Commit SHA

```bash
gh pr view [PR_NUMBER] --json headRefOid --jq '.headRefOid'
```

### Batch Comments

Post all comments in a review to reduce noise:

```bash
gh api repos/:owner/:repo/pulls/[PR_NUMBER]/reviews \
  --method POST \
  -f body="Code review complete. See inline comments." \
  -f event="COMMENT" \
  -f comments='[
    {"path": "file1.ts", "line": 10, "body": "..."},
    {"path": "file2.ts", "line": 25, "body": "..."}
  ]'
```

## Phase 5: Summary

Output review summary:

```
Code Review Complete: PR #[NUMBER] "[TITLE]"

Issues Found:
- Critical: [X]
- Major: [Y]
- Minor: [Z]

Categories:
- Security: [count]
- DRY Violations: [count]
- Over-complications: [count]
- CLAUDE.md Violations: [count]
- Missing Tests: [count]
- Style: [count]

[X] comments posted to PR.
```

## Review Checklist

Use this checklist for each PR:

```
[ ] Security: No injection vulnerabilities, secrets, or auth issues
[ ] DRY: No code repeated 3+ times
[ ] Simplicity: No premature abstractions or over-engineering
[ ] Effect-TS: Backend services use Effect patterns
[ ] React: No unnecessary useEffect, uses tRPC for data
[ ] Tests: Business logic has unit tests
[ ] E2E: Frontend changes have Playwright tests
[ ] Integration: Inngest functions have integration tests
[ ] Style: Follows Biome rules, consistent naming
```

## Error Handling

### No PR Found
```
Error: No PR found for current branch.
Options:
1. Create PR: gh pr create
2. Specify number: /code-review 123
```

### No Changes to Review
```
PR #[NUMBER] has no changed files to review.
```

### gh CLI Not Authenticated
```
Error: GitHub CLI not authenticated.
Run: gh auth login
```
