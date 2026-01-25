# Interview Questions Reference

Templates for gathering information about invisible dependencies during contract generation.

**This skill is technology-agnostic.** Interview questions adapt based on detected technology or fall back to generic questions when the stack is unknown.

## Question Categories

1. **Technology Stack** - Confirming detected technologies (NEW)
2. **Service Boundaries** - Understanding module/service organization
3. **External Triggers** - Who calls these endpoints from outside
4. **Event Consumers** - Cross-repo event subscriptions
5. **Database Sharing** - Tables read/written by multiple services
6. **Business Invariants** - Rules that must always hold
7. **Error Contracts** - What can go wrong and how callers handle it
8. **Manual Entry** - For contracts that couldn't be auto-discovered (NEW)

---

## Technology Stack Questions (NEW)

### Stack Confirmation

**Use when:** After initial technology detection, to confirm findings

```
I detected the following technologies in your codebase:
- Programming language(s): [detected - e.g., "Python, TypeScript"]
- Web framework: [detected - e.g., "FastAPI" or "Unknown"]
- Database: [detected - e.g., "PostgreSQL via SQLAlchemy" or "Unknown"]
- Message queue: [detected - e.g., "Celery/Redis" or "None detected"]

Is this correct?

Options:
- Yes, this is accurate
- Partially correct (please specify what's different)
- No, let me describe my stack
```

### Unknown Framework

**Use when:** Framework couldn't be auto-detected

```
I couldn't automatically detect your web framework.

What framework are you using for HTTP endpoints?

Options:
- None (this is a library/CLI tool)
- Custom/internal framework (please describe)
- [Language-specific options based on detected language]
```

**Python-specific:**
```
Options:
- Flask
- FastAPI
- Django
- Starlette
- aiohttp
- Other (please specify)
```

**Go-specific:**
```
Options:
- Standard library (net/http)
- Gin
- Echo
- Chi
- Fiber
- Other (please specify)
```

**Rust-specific:**
```
Options:
- Actix-web
- Axum
- Rocket
- Warp
- Other (please specify)
```

### Custom Conventions

**Use when:** Standard patterns don't match the codebase

```
Your codebase appears to use custom conventions for [endpoints/database/events].

Can you describe how [endpoints/database/events] are defined in your code?

For example:
- What decorator/annotation/function marks an HTTP endpoint?
- What file naming convention do you use?
- Are there configuration files that define routes?
```

---

## Service Boundary Questions

### Module Organization

**Use when:** You've found multiple directories that might be separate services

```
I found the following modules in your codebase:
- /src/orders (12 files)
- /src/users (8 files)
- /src/payments (5 files)

How are these organized?

Options:
- Separate deployable services (each deploys independently)
- Modules within a monolith (single deployment)
- Mixed (please specify which are separate)
```

### Deployment Boundaries

**Use when:** Unclear if modules are independently deployed

```
For the [ModuleName] directory, is this:

Options:
- Part of the main application deployment
- A separate service with its own deployment
- A shared library/package used by multiple services
```

---

## External Trigger Questions

### HTTP Endpoint Callers

**Use when:** You find HTTP endpoints that might have external callers

```
I found this endpoint: [METHOD] [path]
Example: POST /api/orders

Who calls this endpoint?

Options:
- Only this codebase (internal only)
- Another internal service (specify which)
- External clients - mobile app
- External clients - third party integrations
- Public API (documented for external developers)
```

### API Consumer Details

**Use when:** User indicates external callers exist

```
You mentioned [endpoint] is called by [external caller].

Please provide details:
- Service/app name:
- Repository (if internal):
- How are changes coordinated?
- Is there a formal API contract?
```

---

## Event Consumer Questions

### Event Subscribers

**Use when:** You find event publishing code

```
This code publishes a [EventName] event.
Location: [file:line]

Who consumes this event?

Options:
- Only consumers in this repo
- Consumers in other repositories (specify which)
- External systems (webhooks, third parties)
- Unknown / needs investigation
```

### Cross-Repo Event Details

**Use when:** User indicates cross-repo event consumers

```
For the [EventName] event consumed by [consumer]:

Please provide:
- Repository URL/name:
- Handler location (if known):
- Is the event schema formally documented?
- What happens if the event schema changes?
```

### Event Schema Ownership

**Use when:** Multiple services use the same events

```
The [EventName] event is used by multiple services.

Who owns the event schema?

Options:
- This repository defines the schema
- Another repository defines it (specify which)
- Shared package/schema registry
- No formal ownership (ad-hoc)
```

---

## Database Sharing Questions

### Table Readers

**Use when:** You find database write operations

```
The '[table_name]' table is written to in this codebase.
Location: [file:line]

Is this table read by other services?

Options:
- No, only this service reads it
- Yes, other services read it directly (specify which)
- Yes, via an API (not direct DB access)
- Unknown
```

### Table Ownership

**Use when:** Multiple services access the same table

```
Multiple services access the '[table_name]' table.

Who owns this table?

Options:
- This service owns it (others are guests)
- Another service owns it (we are guests)
- Shared ownership (no clear owner)
- Legacy situation (needs cleanup)
```

### Database Access Patterns

**Use when:** Investigating shared database access

```
For the '[table_name]' table:

What access patterns exist?
- [ ] Read by this service
- [ ] Written by this service
- [ ] Read by other services (list them)
- [ ] Written by other services (list them)
- [ ] Has foreign keys to other tables
- [ ] Referenced by other tables
```

---

## Business Invariant Questions

### Function Invariants

**Use when:** You find critical business functions

```
For [ServiceName.functionName]:
Location: [file:line]

What business rules must ALWAYS be true?

Examples:
- "Email must be unique in the system"
- "Account balance cannot go negative"
- "Order total must equal sum of line items"
- "User must be verified to place orders"

Please list all invariants:
```

### Data Integrity Rules

**Use when:** You find data models or database operations

```
For the '[EntityName]' entity/table:

What integrity rules apply?

Examples:
- Required fields
- Unique constraints
- Value range limits
- Referential integrity
- State machine rules

Please list all rules:
```

### Cross-Entity Invariants

**Use when:** Multiple entities are related

```
When [OperationName] occurs:

What must remain consistent across entities?

Examples:
- "Payment amount must match invoice total"
- "Inventory count must reflect all orders"
- "User settings must be copied to all devices"

Please describe consistency requirements:
```

---

## Error Contract Questions

### Error Types

**Use when:** You find public APIs or service boundaries

```
For [functionName/endpoint]:
Location: [file:line]

What errors can this return that callers must handle?

Please list error types with descriptions:
- ErrorName: When it occurs, what caller should do
```

### Error Handling Requirements

**Use when:** Understanding how callers should respond

```
When [ErrorName] is returned:

How should callers handle this?

Options:
- Retry (with backoff)
- Fail immediately (non-recoverable)
- Show user message
- Fallback to alternative
- Log and continue
```

### Error Response Format

**Use when:** Documenting API error contracts

```
For errors from [endpoint/service]:

What is the error response format?

Example:
{
  "error": "ERROR_CODE",
  "message": "Human readable message",
  "details": { ... }
}

Please describe the format:
```

---

## External Dependency Questions

### Third-Party APIs

**Use when:** You find external API calls

```
I found a call to [URL/Service].
Location: [file:line]

Please provide details:
- Service name:
- What it's used for:
- API documentation URL:
- Rate limits or quotas:
- Fallback behavior if unavailable:
```

### External Webhooks

**Use when:** Investigating incoming webhooks

```
Does this codebase receive webhooks from external services?

If yes, for each webhook:
- Service name:
- Endpoint that receives it:
- Event types:
- How to verify authenticity:
```

---

## Version and Change Management

### API Versioning

**Use when:** Understanding change management

```
For [endpoint/contract]:

How are breaking changes handled?

Options:
- No versioning (breaking changes are coordinated)
- URL versioning (/v1/, /v2/)
- Header versioning
- Content negotiation
- Other (describe)
```

### Deprecation Process

**Use when:** Understanding lifecycle

```
When deprecating functionality:

What is the process?

Options:
- No formal process
- Deprecation warnings in responses
- Documentation updates
- Direct notification to consumers
- Migration period before removal
```

---

---

## Manual Contract Entry (NEW)

**Use when:** Automatic discovery missed contracts or user wants to add contracts for undiscovered components

### Entry Prompt

**Use when:** User indicates there are missing contracts

```
Would you like to manually define contracts that I may have missed?

I'll guide you through entering each contract. For each one, I'll ask about:
1. Contract name and type
2. Location in the codebase
3. What it exposes (if anything)
4. What it depends on

Ready to add a contract?
```

### Contract Type Selection

```
What type of contract would you like to add?

Options:
- HTTP Endpoint (REST, GraphQL, gRPC)
- Event Publisher
- Event Consumer
- Database Table/Operation
- External API Call
- Background Job/Worker
- Other (please describe)
```

### HTTP Endpoint Entry

```
For this HTTP endpoint, please provide:

1. HTTP method: [GET/POST/PUT/PATCH/DELETE/other]
2. Path: [e.g., /api/users/:id]
3. File location: [e.g., src/handlers/users.py:45]
4. Handler function name: [optional]
5. Input schema/type: [optional]
6. Output schema/type: [optional]
```

### Event Entry

```
For this event, please provide:

1. Event name: [e.g., OrderPlaced]
2. Event type: [publish/consume/both]
3. File location: [e.g., src/events/orders.go:78]
4. Event schema/payload: [optional - describe the data structure]
5. Queue/topic name: [optional]
```

### Database Operation Entry

```
For this database operation, please provide:

1. Table name: [e.g., orders]
2. Operation type: [read/write/both]
3. File location: [e.g., src/models/order.rs:23]
4. Primary key field: [optional]
5. Important columns: [optional]
```

### External API Entry

```
For this external API call, please provide:

1. Service name: [e.g., Stripe, Twilio, internal-auth-service]
2. Base URL: [if known, e.g., https://api.stripe.com]
3. File location: [e.g., src/services/payment.java:56]
4. What it's used for: [brief description]
5. Rate limits or quotas: [if known]
```

### Batch Entry

**Use when:** User has multiple contracts to add

```
You can add multiple contracts at once. Please list them in this format:

For each contract:
---
Type: [endpoint/event/database/external]
Name: [contract name]
Location: [file:line]
Details: [type-specific details]
---

Example:
---
Type: endpoint
Name: GET /api/products
Location: src/routes/products.rb:12
Details: Returns paginated list of products
---
Type: event
Name: ProductCreated
Location: src/events/product_events.rb:45
Details: Published when a new product is created
---
```

### Confirmation

**Use after each manual entry:**

```
I've recorded this contract:

​```
[Contract Summary]
- Type: [type]
- Name: [name]
- Location: [location]
- [Additional details]
​```

Is this correct?

Options:
- Yes, continue
- No, let me correct it
- Cancel this entry
```

---

## Tips for Effective Interviews

1. **Ask one question at a time** - Don't overwhelm with multiple questions

2. **Provide examples** - Show concrete examples of what you're looking for

3. **Offer options** - Give multiple choice when appropriate to make answering easier

4. **Follow up on unclear answers** - If "other" is selected, ask for specifics

5. **Summarize what you learned** - Confirm understanding before moving on

6. **Focus on what static analysis can't see** - Don't ask about things you can discover from code

7. **Prioritize high-impact contracts** - Focus on frequently called or critical paths

8. **Note uncertainty** - If the user isn't sure, document that in the contract

9. **Adapt to the tech stack** - Use language-appropriate terminology

10. **Offer manual entry** - When auto-discovery fails, guide users through manual input

11. **Be framework-agnostic** - Don't assume specific conventions; ask when unsure
