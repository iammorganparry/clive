# User Story Writing Guide

This guide helps you write effective user stories that deliver value and provide clear requirements for implementation.

## What is a User Story?

A user story describes a piece of functionality from the perspective of the person who desires it. It answers three questions:

1. **WHO** needs this?
2. **WHAT** do they want?
3. **WHY** do they need it?

## The Standard Format

```
As a [type of user]
I want [capability]
So that [benefit/value]
```

This format forces you to think about:
- The stakeholder (who benefits)
- The feature (what they're getting)
- The business value (why it matters)

## Examples

### Good User Stories

✅ **Example 1: Feature**
```
As a developer
I want to see type errors in real-time in my editor
So that I can catch bugs before running the code
```

**Why it's good:**
- Clear user (developer)
- Specific capability (real-time type errors)
- Clear benefit (catch bugs earlier)

✅ **Example 2: User-Facing Feature**
```
As a user
I want to export my dashboard data as CSV
So that I can analyze it in Excel
```

**Why it's good:**
- Identifies the end user
- Describes specific action
- Explains the downstream use case

✅ **Example 3: System Improvement**
```
As a system administrator
I want automated database backups every 6 hours
So that we can recover from data loss quickly
```

**Why it's good:**
- Identifies the role
- Specific, measurable frequency
- Clear risk mitigation benefit

### Bad User Stories

❌ **Example 1: Implementation-Focused**
```
As a developer
I want to add OAuth middleware to the Express server
So that we have authentication
```

**Why it's bad:**
- Focuses on HOW (middleware implementation)
- Should focus on WHAT user capability this enables
- "So that we have authentication" is not a user benefit

**Better version:**
```
As a user
I want to log in using my Google account
So that I don't need to remember another password
```

❌ **Example 2: Too Vague**
```
As a user
I want the system to work better
So that I have a good experience
```

**Why it's bad:**
- "Work better" is not specific
- "Good experience" is not measurable
- Doesn't describe a concrete capability

**Better version:**
```
As a user
I want search results to appear within 2 seconds
So that I can find information quickly
```

❌ **Example 3: Multiple Stories in One**
```
As a developer
I want to set up CI/CD, add linting, configure testing, and deploy to production
So that we have a complete development pipeline
```

**Why it's bad:**
- Contains 4 separate stories
- Too large to implement in one task
- Hard to verify "done"

**Better version: Break into separate stories**
```
Story 1: As a developer, I want automated linting on every commit, so that code style is consistent

Story 2: As a developer, I want automated tests to run on pull requests, so that bugs are caught before merge

Story 3: As a developer, I want automated deployment to staging, so that changes can be previewed safely

Story 4: As a developer, I want automated deployment to production, so that releases are reliable
```

## Types of Users/Roles

Choose the most specific role that makes sense:

**End Users:**
- User (generic)
- Customer
- Visitor
- Guest
- Subscriber

**Internal Users:**
- Developer
- Designer
- Product Manager
- System Administrator
- Support Agent

**System/Technical:**
- System (for automated processes)
- API Consumer
- Integration Service

## Writing the "So That" (Benefit)

The benefit should explain the **value** delivered, not just restate the capability.

### Weak Benefits (just restates capability)

❌ "So that I can have this feature"
❌ "So that the system does X"
❌ "So that we implement Y"

### Strong Benefits (explains value)

✅ "So that I can make informed decisions faster"
✅ "So that I reduce manual work and errors"
✅ "So that users don't abandon the checkout process"
✅ "So that we comply with GDPR requirements"

## User Stories vs Implementation Tasks

User stories describe **user value**. Implementation tasks describe **technical work**.

| User Story (Good) | Implementation Task (Bad) |
|-------------------|---------------------------|
| User can log in with Google OAuth | Add OAuth middleware to Express |
| Admin can view user analytics dashboard | Create analytics API endpoint |
| User receives email when order ships | Implement SendGrid integration |
| Developer sees build status in PR | Add GitHub Actions workflow file |

**Key difference:** User stories answer "What capability does the user get?" while implementation tasks answer "What code do we write?"

## Breaking Down Large Stories

If a story feels too big, use these techniques to split it:

### 1. By User Workflow Steps
```
Too big: "User can complete checkout process"

Split into:
- User can add items to cart
- User can review cart before checkout
- User can enter shipping information
- User can enter payment information
- User receives order confirmation
```

### 2. By User Persona
```
Too big: "Users can manage their profiles"

Split into:
- Customer can update their email and password
- Vendor can update their business information
- Admin can deactivate user accounts
```

### 3. By Happy Path vs Edge Cases
```
Too big: "User can upload and validate files"

Split into:
- User can upload CSV files (happy path)
- User sees validation errors for invalid CSV format
- User can retry upload after fixing errors
```

### 4. By Acceptance Criteria
If you have 10 acceptance criteria, you might have 2-3 stories hiding in one.

## Common Patterns

### CRUD Operations
```
As a [user]
I want to [create/read/update/delete] [entity]
So that I can [manage my data/track information/etc.]
```

### Search/Filter
```
As a [user]
I want to search/filter [content] by [criteria]
So that I can find [specific items] quickly
```

### Notifications
```
As a [user]
I want to receive [notification type] when [event occurs]
So that I can [take timely action/stay informed]
```

### Reports/Analytics
```
As a [user]
I want to view [metric/report]
So that I can [make decisions/track performance]
```

## Checklist for a Good User Story

Before finalizing a user story, verify:

- [ ] Identifies a specific user role or persona
- [ ] Describes a clear, single capability
- [ ] Explains the business value or benefit
- [ ] Is written from user perspective (not implementation)
- [ ] Is small enough to implement in one task (< 100k tokens)
- [ ] Can be paired with specific acceptance criteria
- [ ] Is testable and verifiable

## User Stories and Acceptance Criteria

Every user story should be paired with acceptance criteria that make it testable. See the [Acceptance Criteria Guide](./acceptance-criteria.md) for details.

Example:
```
User Story:
As a user
I want to export my data as CSV
So that I can analyze it in Excel

Acceptance Criteria:
1. Export button appears on dashboard
2. Clicking button downloads CSV file
3. CSV contains all user data in readable format
4. Export completes within 5 seconds
5. User sees progress indicator during export
```

## Resources

- **Planning Agent**: Uses these patterns when creating plans (see `/apps/tui/commands/plan.md`)
- **Skills**: Feature, bugfix, and refactor skills read user stories to understand requirements
- **Templates**: See `/apps/tui/templates/task-template.md` for full task structure
