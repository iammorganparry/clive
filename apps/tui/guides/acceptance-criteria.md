# Acceptance Criteria Guide

This guide helps you write effective acceptance criteria that clearly define "done" for user stories and tasks.

## What Are Acceptance Criteria?

Acceptance criteria are specific, testable conditions that must be met for a user story or task to be considered complete. They:

- Define the boundaries of the feature
- Provide a shared understanding between stakeholders and implementers
- Form the basis for test cases
- Help verify that requirements are met

## The INVEST Principles

Good acceptance criteria follow the INVEST principles:

- **Independent**: Can be verified without depending on other criteria
- **Negotiable**: Open to discussion and refinement
- **Valuable**: Represents user value, not implementation details
- **Estimable**: Clear enough to estimate effort
- **Small**: Focused on one specific behavior or outcome
- **Testable**: Can be verified objectively

## Characteristics of Good Acceptance Criteria

### 1. Testable

Can you verify whether it's working?

✅ **Good:** "User sees error message when login fails"
- Can test: Try logging in with wrong password, verify error appears

❌ **Bad:** "Code is well-structured"
- How do you test this objectively?

### 2. Specific

Is it clear and unambiguous?

✅ **Good:** "Search returns results within 2 seconds"
- Specific timing requirement

❌ **Bad:** "System works correctly"
- What does "correctly" mean?

### 3. Measurable

Can you determine pass/fail?

✅ **Good:** "Form validation shows inline errors below invalid fields"
- Clear pass/fail: Either errors appear or they don't

❌ **Bad:** "Performance is good"
- What's "good"? No objective measure

### 4. User-Focused

Does it describe behavior from user perspective?

✅ **Good:** "User can export data as CSV"
- User-facing capability

❌ **Bad:** "OAuth middleware is implemented"
- Implementation detail, not user behavior

## Writing Acceptance Criteria

### Format Options

**Option 1: Given-When-Then (Gherkin style)**
```
Given [context/precondition]
When [action/event]
Then [expected outcome]
```

Example:
```
Given I am logged in as an admin
When I click the "Export Users" button
Then a CSV file downloads containing all user data
```

**Option 2: Scenario-Based**
```
Scenario: [Description]
- [Criterion 1]
- [Criterion 2]
- [Criterion 3]
```

Example:
```
Scenario: User exports data
- Export button appears on dashboard
- Clicking button downloads CSV file
- CSV contains all user data
- Export completes within 5 seconds
```

**Option 3: Simple List (Recommended for Clive)**
```
1. [Specific, testable criterion]
2. [Specific, testable criterion]
3. [Specific, testable criterion]
```

Example:
```
1. User sees "Sign in with Google" button on login page
2. Clicking button redirects to Google OAuth flow
3. After successful auth, user is logged into system
4. Error message shows if OAuth fails
5. User profile populated from Google data
```

## Examples by Category

### Feature Implementation

**User Story:** User can filter search results by date range

**Acceptance Criteria:**
1. Date range picker appears above search results
2. Selecting start and end dates updates results immediately
3. Only results within date range are displayed
4. "Clear filters" button resets date range
5. Date range persists when navigating away and back

### Bug Fix

**User Story:** Login no longer crashes when user ID not found

**Acceptance Criteria:**
1. Entering nonexistent user ID shows "User not found" error
2. Error message is user-friendly (not technical stack trace)
3. User can retry login after error
4. All existing login flows still work
5. No console errors or crashes

### Refactoring

**User Story:** Duplicate validation logic extracted into shared validator

**Acceptance Criteria:**
1. All 3 instances of duplicate validation use new UserValidator
2. Validation behavior unchanged (all existing tests pass)
3. Code is more maintainable (single source of truth)
4. No performance degradation
5. Build succeeds with no type errors

## Common Patterns

### Happy Path + Error Cases
```
Happy Path:
1. User successfully completes action
2. System shows success message
3. Data is persisted correctly

Error Cases:
4. Invalid input shows inline validation error
5. Network failure shows retry option
6. Timeout shows helpful error message
```

### UI/UX Criteria
```
1. Button appears in expected location
2. Button is disabled until form is valid
3. Loading spinner shows during save
4. Success message appears after save
5. Form clears after successful submission
```

### Performance Criteria
```
1. Page loads in under 2 seconds
2. Search returns results within 500ms
3. Export handles 10,000 records without timeout
4. No memory leaks after 1000 operations
```

### Accessibility Criteria
```
1. All interactive elements are keyboard accessible
2. Screen reader announces form errors
3. Color contrast meets WCAG AA standards
4. Focus indicators are visible
```

## Good vs Bad Examples

### Example 1: Form Validation

❌ **Bad Acceptance Criteria:**
```
1. Form validation works
2. Errors are handled
3. User experience is good
```

**Problems:** Vague, not testable, not specific

✅ **Good Acceptance Criteria:**
```
1. Email field shows error if format is invalid (e.g., "missing @")
2. Password field shows error if less than 8 characters
3. Submit button is disabled until all fields are valid
4. Error messages appear inline below invalid fields
5. Error messages are clear and actionable (e.g., "Email must contain @")
```

**Why it's good:** Specific, testable, covers multiple scenarios

### Example 2: Search Functionality

❌ **Bad Acceptance Criteria:**
```
1. Search works
2. Results are relevant
3. Fast performance
```

**Problems:** Not measurable, subjective

✅ **Good Acceptance Criteria:**
```
1. Typing in search box shows results within 500ms
2. Results match query string (case-insensitive)
3. Results are ranked by relevance (exact matches first)
4. Empty query shows all items
5. No results shows "No items found" message
6. Search handles special characters without errors
```

**Why it's good:** Measurable timing, specific behavior, covers edge cases

### Example 3: Authentication

❌ **Bad Acceptance Criteria:**
```
1. OAuth is implemented
2. Users can log in
3. Security is handled correctly
```

**Problems:** Implementation-focused, vague security claim

✅ **Good Acceptance Criteria:**
```
1. "Sign in with Google" button appears on login page
2. Clicking button redirects to Google OAuth consent screen
3. After granting consent, user is redirected back and logged in
4. User session persists across page refreshes
5. Invalid OAuth token shows "Authentication failed" error
6. User can log out and session is terminated
```

**Why it's good:** User-focused, specific user flows, covers error cases

## How Many Acceptance Criteria?

**General guideline: 3-7 criteria per user story**

- **Too few (1-2):** Probably not specific enough
- **Just right (3-7):** Covers happy path, edge cases, and key scenarios
- **Too many (10+):** Story is too large, should be split

**Exception:** Simple tasks might have 2-3 criteria if truly straightforward.

## Acceptance Criteria vs Definition of Done

**Acceptance Criteria:**
- Specific to THIS story/task
- Describes WHAT the feature does
- User-facing behavior

**Definition of Done:**
- Applies to ALL stories/tasks
- Describes HOW we deliver quality
- Process and quality standards

Example:

**Acceptance Criteria (specific to task):**
1. User can export data as CSV
2. Export includes all visible columns
3. Export completes within 5 seconds

**Definition of Done (applies to all tasks):**
- [ ] All acceptance criteria met
- [ ] Unit tests written and passing
- [ ] Build succeeds
- [ ] Code reviewed
- [ ] Documentation updated

## Acceptance Criteria Checklist

Before finalizing acceptance criteria, verify:

- [ ] Each criterion is testable (can verify pass/fail)
- [ ] Each criterion is specific (not vague)
- [ ] Each criterion is measurable (objective, not subjective)
- [ ] Covers the happy path (normal user flow)
- [ ] Covers error cases (what happens when things go wrong)
- [ ] Covers edge cases (boundary conditions, unusual inputs)
- [ ] Written from user perspective (not implementation)
- [ ] Independent of each other (can verify separately)
- [ ] Total of 3-7 criteria (not too few, not too many)

## Using Acceptance Criteria in Development

### For Planning Agents
- Generate acceptance criteria during stakeholder interview
- Base them on user requirements and use cases
- Include in plan file for implementers to reference

### For Implementation Skills (feature, bugfix, refactor)
- Read acceptance criteria from task at start of Phase 1
- Use them to guide implementation decisions
- Verify ALL criteria in Phase 4 before marking complete

### For Testing
- Each acceptance criterion becomes one or more test cases
- Tests should fail if criterion is not met
- Tests should pass when criterion is satisfied

## Template

Use this template when writing acceptance criteria:

```markdown
## Acceptance Criteria

1. [Happy path - main user flow]
2. [Happy path - successful outcome]
3. [Data/state handling]
4. [Error case 1]
5. [Error case 2]
6. [Edge case or performance requirement]
7. [UI/UX requirement]
```

## Resources

- **User Stories**: See [User Story Writing Guide](./user-story-writing.md)
- **Planning Agent**: Uses these patterns (see `/apps/tui/commands/plan.md`)
- **Skills**: Feature, bugfix, and refactor skills verify acceptance criteria
- **Templates**: See `/apps/tui/templates/task-template.md`
