---
name: pr-review
description: Review PRs where you're a reviewer and haven't reviewed yet using gh CLI. Checks for duplicate code, unnecessary complexity, useEffect abuse, code style violations, and messy tests. Leaves concise feedback with code suggestions.
allowed-tools: Bash, Read, Grep, Glob
---

# PR Review Skill

Automate code review for GitHub pull requests where you're a requested reviewer. This skill uses the gh CLI to find PRs awaiting your review, analyze code changes, and provide structured feedback based on best practices.

## When to Use This Skill

- User wants to review PRs where they're a requested reviewer
- User asks to check PRs awaiting their review
- User wants automated code review with specific criteria

## Review Workflow

### 1. Find PRs
Use `gh pr list --search "user-review-requested:@me" --state open` to get all open PRs where you're a requested reviewer and haven't reviewed yet.

### 2. Select PR to Review
- If no PRs found, inform the user
- If one PR found, review it automatically
- If multiple PRs found, show the list and ask which to review (or offer to review all)

### 3. Gather PR Context
For each PR to review:
```bash
# Get PR overview
gh pr view <number>

# Get the diff
gh pr diff <number>

# Get list of changed files
gh pr view <number> --json files --jq '.files[].path'
```

### 4. Read Full File Context
For each changed file, read the ENTIRE file (not just the diff) to understand context and detect patterns.

### 5. Review Against Criteria
Check the code changes against these criteria in priority order:

#### 1. Unnecessary useEffect (HIGHEST PRIORITY)
React components should avoid useEffect when possible. Look for:

**Anti-pattern - Computing derived state:**
```typescript
// BAD
const [total, setTotal] = useState(0);
useEffect(() => {
  setTotal(items.reduce((sum, item) => sum + item.price, 0));
}, [items]);

// GOOD - compute during render
const total = items.reduce((sum, item) => sum + item.price, 0);
```

**Anti-pattern - Synchronizing state:**
```typescript
// BAD
useEffect(() => {
  setValue(computeValue(prop));
}, [prop]);

// GOOD
const value = computeValue(prop);
```

**Anti-pattern - Data fetching with tRPC:**
```typescript
// BAD
useEffect(() => {
  fetch('/api/data').then(setData);
}, []);

// GOOD - use tRPC's useQuery
const { data } = api.getData.useQuery();
```

**Valid useEffect uses:**
- Actual side effects (DOM manipulation, subscriptions, timers)
- Third-party library integration
- Browser API interactions

#### 2. Duplicate Code
Look for repeated logic across files:
- Similar function implementations
- Repeated utility logic
- Copy-pasted code blocks
- Duplicated validation logic
- Repeated component patterns

**Example feedback:**
```
This validation logic is duplicated in UserForm.tsx and ProfileForm.tsx. Extract to a shared utility.

// src/utils/validation.ts
export const validateEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
```

#### 3. Unnecessary Complexity
Check for over-engineering:
- Premature abstractions (helper functions used once)
- Overly generic utilities
- Feature flags for single use cases
- Unnecessary error handling for internal code
- Complex conditionals that could be simplified

**Example feedback:**
```
This abstraction is only used once. Inline it for simplicity per YAGNI principle.

// Instead of creating formatUserName(), just use:
const displayName = user.firstName + ' ' + user.lastName;
```

#### 4. Code Style Violations
Check against CLAUDE.md guidelines:
- Ternaries in JSX (should be avoided - use declarative code)
- Not using Effect for backend logic
- Not using tRPC for data fetching
- Improper error handling patterns
- Missing dayjs for date operations

**Example feedback:**
```
Avoid ternaries in JSX per CLAUDE.md. Use early returns or declarative rendering.

// Instead of: {loading ? <Spinner /> : <Content />}
if (loading) return <Spinner />;
return <Content />;
```

#### 5. Messy Tests
Check test files for:
- Duplicated setup code across tests
- Repeated mock configurations
- Long beforeEach blocks
- Test utilities that should be extracted
- Unclear test organization

**Example feedback:**
```
Extract repeated mock setup to a test utility. This setup is duplicated across 4 test files.

// __tests__/utils/mocks.ts
export const mockUser = () => ({ id: '1', name: 'Test User' });
```

### 6. Prepare Review Comments
Collect all issues found and prepare review comments:
- Each comment should be 1-2 sentences maximum
- Always include a code snippet showing the fix
- Reference CLAUDE.md guidelines when applicable
- Be specific about the file and line
- Group related issues together

### 7. Submit Review
Use gh CLI to submit the review:

**If issues found:**
```bash
gh pr review <number> --request-changes --body "Found issues with code quality. See inline comments."
```

**If no issues:**
```bash
gh pr review <number> --approve --body "LGTM! Code follows best practices."
```

**For inline comments:**
```bash
gh pr review <number> --comment --body "<comment>" --file <path> --line <number>
```

## gh CLI Command Reference

### Listing and Viewing PRs
```bash
# List PRs where you're a requested reviewer and haven't reviewed yet
gh pr list --search "user-review-requested:@me" --state open

# View PR details
gh pr view <number>
gh pr view <number> --json title,body,files,additions,deletions

# Get the diff
gh pr diff <number>

# Get changed files
gh pr view <number> --json files --jq '.files[].path'
```

### Submitting Reviews
```bash
# Approve PR
gh pr review <number> --approve --body "LGTM!"

# Request changes
gh pr review <number> --request-changes --body "Please address the following issues..."

# Add comment without approving/requesting changes
gh pr review <number> --comment --body "Consider refactoring this..."

# Add inline comment on specific line
gh pr review <number> --comment --body "This could be simplified" --file src/App.tsx --line 42
```

## Example Reviews

### Example 1: Unnecessary useEffect
```
File: src/components/UserProfile.tsx, Line 23

This useEffect is unnecessary. Compute the derived state during render instead.

// Replace this:
const [fullName, setFullName] = useState('');
useEffect(() => {
  setFullName(`${user.firstName} ${user.lastName}`);
}, [user]);

// With this:
const fullName = `${user.firstName} ${user.lastName}`;
```

### Example 2: Duplicate Code
```
File: src/components/LoginForm.tsx, Line 45

This email validation is duplicated in SignupForm.tsx. Extract to shared utility.

// src/utils/validation.ts
export const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
```

### Example 3: Over-Engineering
```
File: src/utils/formatters.ts, Line 12

This abstraction is only used once. Follow YAGNI - inline it at the call site.

// Instead of creating formatPrice(), just use:
const price = `$${(amount / 100).toFixed(2)}`;
```

### Example 4: Code Style Violation
```
File: src/components/Dashboard.tsx, Line 67

Avoid ternaries in JSX per CLAUDE.md. Use early returns for better readability.

// Replace this:
return (
  <div>
    {loading ? <Spinner /> : error ? <Error /> : <Content data={data} />}
  </div>
);

// With this:
if (loading) return <Spinner />;
if (error) return <Error />;
return <Content data={data} />;
```

### Example 5: Approval Message
```
LGTM! Code is clean, follows project conventions, and no issues detected. Nice work on the test coverage.
```

## Best Practices

1. **Read Full Files**: Always read the complete file, not just the diff, to understand context
2. **Be Specific**: Reference exact file paths and line numbers
3. **Provide Solutions**: Every critique must include a code snippet showing the fix
4. **Stay Concise**: 1-2 sentences per issue maximum
5. **Reference Standards**: Cite CLAUDE.md when pointing out style violations
6. **Group Related Issues**: If multiple instances of the same pattern, create one comprehensive comment
7. **Be Constructive**: Frame feedback as improvements, not criticisms
8. **Verify Before Commenting**: Ensure the issue is real before flagging it

## Error Handling

If gh CLI commands fail:
- Check if user is authenticated: `gh auth status`
- Check if in a git repository
- Verify PR number exists
- Ensure network connectivity

If no PRs found:
- Inform the user they have no PRs awaiting their review
- Suggest checking all open PRs or different PR states
