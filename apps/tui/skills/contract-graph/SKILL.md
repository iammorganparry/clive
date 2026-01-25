---
name: contract-graph
description: Generate contract definitions by analyzing codebase and interviewing about external dependencies. Use when the user wants to document system contracts, understand invisible dependencies, or create contract definitions for AI agents.
allowed-tools: Bash, Read, Glob, Grep, AskUserQuestion, Write, Edit
model: opus
---

# Contract Graph Generation

Generate comprehensive contract definitions by:
1. Scanning the codebase for API endpoints, database operations, events, and external calls
2. Interviewing about invisible dependencies (cross-repo, external APIs, shared databases)
3. Outputting Mermaid diagrams with full `@contract` annotations
4. Validating the generated contracts

## When to Use

Run `/contract-graph` when you need to:
- Document system contracts for AI agent consumption
- Understand invisible dependencies before major refactoring
- Capture event publishers/consumers across services
- Map database table ownership and sharing
- Document external API dependencies

## Workflow Overview

This skill operates in 5 phases:

1. **Phase 1: Codebase Discovery** - Scan for API endpoints, DB operations, events, external calls
2. **Phase 2: User Interview** - Ask about invisible dependencies
3. **Phase 3: Contract Generation** - Generate Mermaid diagrams with annotations
4. **Phase 4: Validation** - Verify generated contracts are valid
5. **Phase 5: Agent Integration** - Generate AI-optimized docs and update CLAUDE.md

---

## Phase 1: Codebase Discovery

**Goal:** Automatically discover as many contracts as possible from the codebase.

### Step 1.0: Technology Detection (NEW - CRITICAL)

**Before running any discovery patterns, detect the technology stack:**

```bash
# Detect programming language(s) from file extensions
find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.rb" -o -name "*.cs" -o -name "*.php" \) 2>/dev/null | head -100

# Detect frameworks via config files
ls -la package.json Cargo.toml go.mod requirements.txt Pipfile pyproject.toml Gemfile pom.xml build.gradle *.csproj composer.json 2>/dev/null || true
```

**Technology Detection Table:**

| Config File | Language | Common Frameworks |
|-------------|----------|-------------------|
| `package.json` | JavaScript/TypeScript | Express, Fastify, Next.js, tRPC, Hono, NestJS |
| `go.mod` | Go | Gin, Echo, Chi, Fiber, net/http |
| `Cargo.toml` | Rust | Actix-web, Axum, Rocket, Warp |
| `requirements.txt`/`pyproject.toml` | Python | Flask, FastAPI, Django, Starlette |
| `Gemfile` | Ruby | Rails, Sinatra, Hanami |
| `pom.xml`/`build.gradle` | Java | Spring Boot, Quarkus, Micronaut |
| `*.csproj` | C# | ASP.NET Core, Minimal APIs |
| `composer.json` | PHP | Laravel, Symfony |

**Present detection results to user:**

```
I detected the following technologies:
- Programming language(s): [detected]
- Web framework: [detected or unknown]
- Database: [detected or unknown]
- Message queue: [detected or unknown]

Is this correct? Please add any missing technologies.
```

### Step 1.1: Project Structure Analysis

First, understand the project structure:

```bash
ls -la
ls apps/ packages/ src/ cmd/ internal/ lib/ 2>/dev/null || true
```

Identify:
- Monorepo vs single app structure
- Framework(s) in use (adapt based on detected language)
- Database ORM or driver
- Event systems

### Step 1.2: API Endpoint Discovery (Universal + Language-Specific)

**Universal HTTP Patterns (works across ALL languages):**
```bash
# Search for HTTP method indicators
grep -rn "GET\|POST\|PUT\|PATCH\|DELETE" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.rb" --include="*.ts" --include="*.js" --include="*.cs" --include="*.php" . 2>/dev/null | grep -v node_modules | head -100

# Search for route/endpoint patterns (covers most frameworks)
grep -rn "/api/\|@app\.route\|@router\|@GetMapping\|@PostMapping\|HandleFunc\|#\[get\|#\[post\|@Get\|@Post" . 2>/dev/null | grep -v node_modules | head -100
```

**Then apply language-specific patterns from `references/discovery-patterns.md`:**

Use patterns based on the detected language (see discovery-patterns.md for full list).

### Step 1.3: Database Operation Discovery (Universal + Language-Specific)

**Universal SQL Patterns (works across ALL languages):**
```bash
# SQL keywords work in ANY language
grep -rni "SELECT\s\|INSERT\s\|UPDATE\s\|DELETE\s\|CREATE TABLE" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.rb" --include="*.ts" --include="*.js" --include="*.cs" . 2>/dev/null | grep -v node_modules | head -100

# Universal ORM patterns
grep -rn "\.save\|\.create\|\.find\|\.query\|\.execute\|\.commit" . 2>/dev/null | grep -v node_modules | head -100
```

**Then apply language-specific ORM patterns from `references/discovery-patterns.md`.**

### Step 1.4: Event Discovery (Universal)

**Universal Event Patterns (language-agnostic):**
```bash
# Event-related keywords work across ALL languages
grep -rni "publish\|subscribe\|emit\|dispatch\|consume\|producer\|consumer\|event\|message\|queue\|topic" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.rb" --include="*.ts" --include="*.js" --include="*.cs" . 2>/dev/null | grep -v node_modules | grep -v "\.md:" | head -100
```

### Step 1.5: External API Calls (Universal)

**Universal HTTP Client Patterns:**
```bash
# URL patterns (works in ANY language)
grep -rn "https://\|http://" --include="*.py" --include="*.go" --include="*.rs" --include="*.java" --include="*.rb" --include="*.ts" --include="*.js" --include="*.cs" . 2>/dev/null | grep -v node_modules | head -100

# HTTP client patterns
grep -rn "fetch\|request\|client\.\|HttpClient\|requests\.\|http\.Get\|http\.Post\|reqwest\|RestTemplate\|WebClient" . 2>/dev/null | grep -v node_modules | head -100
```

### Step 1.6: Fallback for Unknown Frameworks

**If automatic discovery finds few or no results, fall back to interview-driven discovery:**

```
I couldn't automatically detect many contracts in your codebase.

This could mean:
1. You're using a framework I don't have patterns for
2. The codebase uses custom conventions
3. It's a library/utility without HTTP endpoints

Let me ask some questions to understand your contracts:

1. Does this codebase expose any HTTP/REST/GraphQL/gRPC endpoints?
2. Does it publish or consume any events/messages?
3. Does it read from or write to any databases?
4. Does it call any external APIs or services?
```

**Manual contract entry support:**
```
Would you like to manually define any contracts that I may have missed?
I'll guide you through entering:
- Contract name and location
- What it exposes (endpoints, events)
- What it depends on (databases, external services)
```

### Step 1.6: Compile Discovery Results

Create a structured summary of discovered components:

```markdown
## Discovery Summary

### API Endpoints Found
| Endpoint | File:Line | Method |
|----------|-----------|--------|
| POST /api/users | src/routes/users.ts:23 | createUser |
| ... | ... | ... |

### Database Operations Found
| Table | Operation | File:Line |
|-------|-----------|-----------|
| users | INSERT | src/services/user.ts:45 |
| ... | ... | ... |

### Events Found
| Event Name | Type | File:Line |
|------------|------|-----------|
| OrderPlaced | publish | src/orders/handler.ts:78 |
| ... | ... | ... |

### External Calls Found
| URL/Service | File:Line |
|-------------|-----------|
| https://api.stripe.com | src/payments/stripe.ts:12 |
| ... | ... |
```

---

## Phase 2: User Interview

**Goal:** Gather information about invisible dependencies that static analysis cannot detect.

Use `AskUserQuestion` with the templates from `references/interview-questions.md`.

### Step 2.1: Service Boundary Questions

For each major module/service discovered, ask about boundaries:

```
I found the following modules in your codebase:
- /src/orders (12 files)
- /src/users (8 files)
- /src/payments (5 files)

Do these represent:
- Separate deployable services
- Modules within a monolith
- Mix (please specify)
```

### Step 2.2: Cross-Repository Dependencies

For each event publisher found:

```
This function publishes an [EventName] event.
Does anything OUTSIDE this repo consume this event?

Options:
- No external consumers
- Yes, specify repos/services (opens text input)
```

For each database table written to:

```
The '[table_name]' table is written here.
Is this table read by other services?

Options:
- No, only this service
- Yes (which repos/services?)
```

### Step 2.3: External Callers

For each HTTP endpoint:

```
I found this endpoint: [METHOD] [path]
Is this called by:

Options:
- Only this codebase
- Another service (which repo?)
- External clients (mobile app, third party, public API)
```

### Step 2.4: Business Invariants

For each critical function:

```
For [ServiceName.functionName], what business rules must ALWAYS be true?

Examples:
- Email must be unique
- Password must meet security requirements
- Balance cannot go negative
- Order total must match line items

Please list all invariants:
```

### Step 2.5: Error Contracts

For each API endpoint or public function:

```
What errors can [functionName] return that callers should handle?

Examples:
- UserNotFound
- ValidationError
- PaymentFailed

Please list error types:
```

---

## Phase 3: Contract Generation

**Goal:** Generate Mermaid diagrams with full contract annotations.

### Step 3.1: Create Contracts Directory

```bash
mkdir -p contracts
```

### Step 3.2: Generate System-Level Contract

Create `contracts/system.md` with the overall system architecture:

```markdown
# System Contracts

Generated by contract-graph skill on [DATE]

## System Overview

​```mermaid
graph TB
    subgraph Service1[Service Name]
        %% Service-level contracts here
    end

    subgraph Service2[Another Service]
        %% Service-level contracts here
    end

    %% Cross-service relationships
    Service1 -->|"event: EventName"| Service2
​```

## Detailed Contracts

[Detailed contracts per service below]
```

### Step 3.3: Generate Per-Service Contracts

For each service/module, create a contract section:

```markdown
## [ServiceName] Contracts

​```mermaid
graph TB
    subgraph ServiceName[Service Name]
        %% @contract ServiceName.functionName
        %% @location src/services/service.ts:45
        %% @exposes POST /api/endpoint
        %% @schema {"input": "InputDTO", "output": "OutputType"}
        %% @invariant business rule 1
        %% @invariant business rule 2
        %% @error ErrorType1, ErrorType2
        %% @publishes EventName
        %% @writes table_name
        functionName[functionName]

        %% @contract DB.tableName
        %% @schema {"table": "table_name", "pk": "id"}
        tableName[(table_name)]

        functionName -->|"writes"| tableName
    end
​```
```

### Step 3.4: Annotation Reference

Use these annotations based on discovery:

| Annotation | When to Use | Example |
|------------|-------------|---------|
| `@contract` | Every contract | `@contract UserService.createUser` |
| `@location` | Always - maps to code | `@location src/services/user.ts:23` |
| `@exposes` | HTTP endpoints | `@exposes POST /api/users` |
| `@schema` | When types are known | `@schema {"input": "CreateUserDTO", "output": "User"}` |
| `@invariant` | Business rules from interview | `@invariant email must be unique` |
| `@error` | Error contracts | `@error UserNotFound, ValidationError` |
| `@publishes` | Event publishers | `@publishes OrderPlaced` |
| `@consumes` | Event consumers | `@consumes OrderPlaced` |
| `@reads` | Database reads | `@reads users, orders` |
| `@writes` | Database writes | `@writes orders` |
| `@calls` | External API calls | `@calls PaymentGateway.charge` |
| `@queue` | Message queues | `@queue order-events` |
| `@repo` | Cross-repo dependencies | `@repo github.com/org/service` |
| `@version` | Contract versioning | `@version 1.0.0` |

### Step 3.5: Cross-Service Relationships

Document relationships between services based on interview:

```markdown
## Cross-Service Dependencies

​```mermaid
graph LR
    %% Event flows
    OrderService -->|"publishes: OrderPlaced"| EventBus
    EventBus -->|"consumes: OrderPlaced"| NotificationService
    EventBus -->|"consumes: OrderPlaced"| InventoryService

    %% @repo github.com/org/notification-service
    %% @consumes OrderPlaced
    NotificationService[NotificationService<br/>github.com/org/notification-service]

    %% @repo github.com/org/inventory-service
    %% @consumes OrderPlaced
    InventoryService[InventoryService<br/>github.com/org/inventory-service]
​```
```

---

## Phase 4: Validation

**Goal:** Verify generated contracts are valid and parseable.

### Step 4.1: Check for contract-graph CLI

```bash
which contract-graph || npx contract-graph --version 2>/dev/null
```

### Step 4.2: Run Validation

If contract-graph CLI is available:

```bash
npx contract-graph validate contracts/
```

If not available:
- Verify Mermaid syntax is valid
- Check all `@location` annotations point to existing files
- Verify annotation format is correct

### Step 4.3: Report Issues

Present any validation issues to the user:

```
Contract validation found the following issues:

1. [Issue description]
   - Contract: [contract name]
   - Suggestion: [how to fix]

2. [Issue description]
   ...

Would you like me to fix these issues?
```

### Step 4.4: Final Review

Present the completed contracts for user approval:

```
Contract generation complete!

Created:
- contracts/system.md - [N] contracts defined

Summary:
- [X] API endpoints documented
- [Y] database operations documented
- [Z] events documented
- [W] external dependencies documented

Would you like to review the generated contracts?
```

---

## Phase 5: Agent Integration

**Goal:** Make contracts automatically available to AI agents working in this codebase.

### Step 5.1: Generate AI-Optimized Contract File

Generate the AI-friendly format that's optimized for agent consumption:

```bash
npx @clive/contract-graph docs --dir . --claude --output contracts/CONTRACTS-AI.md 2>&1
```

This creates `contracts/CONTRACTS-AI.md` with:
- Quick reference table of all contracts
- Contracts grouped by file (so agents know what to check when editing)
- Invariants marked with severity icons
- Cross-service dependencies highlighted

### Step 5.2: Update CLAUDE.md

Add or update a "System Contracts" section in CLAUDE.md so that AI agents automatically see contract information.

**Check if CLAUDE.md exists:**

```bash
ls CLAUDE.md 2>/dev/null || echo "CLAUDE.md not found"
```

**If CLAUDE.md exists, check if it already has a contracts section:**

Search for existing "System Contracts" or "Contract Definitions" section.

**Add the contracts section to CLAUDE.md:**

If no contracts section exists, append this section (or update if it exists):

```markdown
## System Contracts

**IMPORTANT:** When making changes to this codebase, review the contract definitions in `contracts/CONTRACTS-AI.md` for the file you're editing. This file contains:

- **Invariants** - Business rules that MUST be maintained
- **Schema definitions** - Input/output types for APIs
- **Database operations** - Which tables are read/written
- **Cross-service dependencies** - What other services depend on this code

**Quick Commands:**

\`\`\`bash
# Query contracts for a specific file
npx @clive/contract-graph query "what contracts affect [FILE_PATH]"

# Analyze impact of changing a contract
npx @clive/contract-graph impact [CONTRACT_ID]

# Validate contracts after changes
npx @clive/contract-graph validate contracts/

# Regenerate AI-optimized docs after code changes
npx @clive/contract-graph docs --dir . --claude --output contracts/CONTRACTS-AI.md
\`\`\`

**Programmatic Access:**

\`\`\`typescript
import { loadContracts, QueryEngine } from '@clive/contract-graph';

const { graph } = await loadContracts('.');
const engine = new QueryEngine(graph);

// Get invariants for a file you're editing
const result = engine.contractsFor('path/to/file.ts');
console.log(result.invariants);

// Analyze impact before making changes
const impact = engine.impactOf('ContractName');
console.log(impact?.warnings);
\`\`\`
```

### Step 5.3: Inject Code Annotations

Inject minimal contract annotations into source files so agents see contract context immediately when reading code.

**For each contract with a `@location` annotation:**

1. Parse the file path and line number from `@location`
2. Read the source file
3. Find the function/class at that line
4. Check for existing JSDoc comment above the target line
5. Inject annotation:
   - If JSDoc exists: Add `@contract` and `@see` tags (merge with existing)
   - If no JSDoc: Create new JSDoc block with contract tags

**Annotation format (minimal):**
```typescript
/**
 * @contract {contractId}
 * @see contracts/system.md#{contractId}
 */
```

**If existing JSDoc has description, preserve it:**
```typescript
/**
 * Create a new conversation for a source file     // <-- existing description preserved
 *
 * @contract conversation.create
 * @see contracts/system.md#conversation.create
 */
```

**Skip injection if:**
- `@contract` tag already exists with same value
- File path in `@location` doesn't exist
- Line number is out of bounds

**Use programmatically:**
```typescript
import { annotateSourceFiles, formatAnnotationResults } from '@clive/contract-graph';

const results = await annotateSourceFiles(graph, {
  contractsFile: 'contracts/system.md',
  dryRun: false,  // Set true to preview without writing
  baseDir: process.cwd()
});

console.log(formatAnnotationResults(results));
```

**Report results to user:**
```
Code annotations injected:
- packages/api/src/router/conversation.ts:17 - conversation.create (added)
- packages/api/src/router/conversation.ts:41 - conversation.getById (added)
- packages/db/src/schema.ts:36 - DB.user (skipped - already annotated)
...

Summary: 15 added, 2 updated, 3 skipped
```

### Step 5.4: Add Contracts to .gitignore (Optional)

Ask the user if they want to track contracts in git:

```
Would you like to:
1. Track contracts in git (recommended for team visibility)
2. Add contracts/ to .gitignore (regenerate on demand)
```

If tracking in git, no action needed.
If ignoring, add to .gitignore:
```
contracts/CONTRACTS-AI.md
contracts/CONTRACTS-DOCS.md
```

### Step 5.5: Present Integration Summary

```
Agent Integration Complete!

Created:
- contracts/CONTRACTS-AI.md - AI-optimized contract documentation
- Updated CLAUDE.md with System Contracts section
- Injected @contract annotations into [N] source files

Now any AI agent working in this codebase will:
1. See the contract section when loading CLAUDE.md
2. See @contract annotations directly in source code when reading files
3. Know to check contracts/CONTRACTS-AI.md when editing files
4. Be able to query contracts programmatically

To keep contracts up to date after code changes:
  npx @clive/contract-graph docs --dir . --claude --output contracts/CONTRACTS-AI.md
```

---

## Output Format

The skill produces contracts in this structure:

```
your-project/
├── CLAUDE.md              # Updated with System Contracts section
├── contracts/
│   ├── system.md          # Main contracts with Mermaid diagrams
│   ├── CONTRACTS-AI.md    # AI-optimized format for agents
│   └── [optional subdirs] # If project is large
│       ├── user-service.md
│       ├── order-service.md
│       └── ...
```

**contracts/system.md** contains:
1. Overview section with high-level Mermaid diagram
2. Detailed contracts section with all `@contract` annotations
3. Cross-service dependencies section

**contracts/CONTRACTS-AI.md** contains:
1. Quick reference table of all contracts
2. Contracts organized by file path (for editing context)
3. Invariants with severity indicators
4. Database read/write operations
5. Event publisher/consumer relationships

**CLAUDE.md** is updated with:
1. Reference to contracts/CONTRACTS-AI.md
2. Quick CLI commands for querying contracts
3. Programmatic access examples for agents

---

## Tips for Quality Contracts

1. **Be specific with locations** - Include exact file:line numbers
2. **Capture invariants** - Business rules are the most valuable annotations for AI agents
3. **Document error contracts** - Callers need to know what can go wrong
4. **Note cross-repo dependencies** - These are invisible to static analysis
5. **Include schema types** - Use actual TypeScript type names when available
6. **Version important contracts** - Use `@version` for contracts with external consumers
