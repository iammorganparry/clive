# @clive/contract-graph

AI-aware contract testing framework using Mermaid-based contract definitions.

## Overview

Contract Graph helps AI agents understand system dependencies and contractual obligations before making code changes. Contracts act as both documentation and guardrails, capturing invisible dependencies that static analysis can't see.

## Installation

```bash
yarn add @clive/contract-graph
# or
npm install @clive/contract-graph
```

## Quick Start

### 1. Define Contracts

Create a `contracts/` directory with markdown files containing Mermaid diagrams:

```markdown
# User Service Contracts

​```mermaid
graph TB
    %% @contract User.create
    %% @location src/services/user.ts:15
    %% @schema {"input": "CreateUserDTO", "output": "User"}
    %% @invariant email must be unique
    %% @error UserAlreadyExists, ValidationError
    createUser[createUser]

    %% @contract DB.users
    %% @schema {"table": "users", "pk": "id"}
    users[(users)]

    createUser -->|"writes"| users
​```
```

### 2. Query Contracts

```bash
# Query contracts for a file
npx contract-graph query --file src/services/user.ts

# Analyze impact of changes
npx contract-graph impact User.create

# Validate contracts (for CI)
npx contract-graph validate

# Generate documentation
npx contract-graph docs --output docs/contracts.md
```

### 3. Programmatic Usage

```typescript
import { buildFromMarkdown, QueryEngine } from '@clive/contract-graph';

const markdown = `...`; // Your contract markdown
const { graph } = buildFromMarkdown(markdown);
const engine = new QueryEngine(graph);

// Query contracts for a file
const result = engine.contractsFor('src/services/user.ts');
console.log(result.invariants);

// Analyze impact of changes
const impact = engine.impactOf('User.create');
console.log(impact?.warnings);
```

## Contract Annotations

### Core Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| `@contract` | Names the contract | `@contract UserService.createUser` |
| `@location` | Maps to code | `@location src/services/user.ts:23` |
| `@schema` | Input/output types | `@schema {"input": "UserInput", "output": "User"}` |
| `@invariant` | Business rules | `@invariant email must be unique` |
| `@error` | Error contracts | `@error UserNotFound, ValidationError` |
| `@version` | Contract version | `@version 1.2.0` |

### Distributed System Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| `@publishes` | Event published | `@publishes OrderPlaced` |
| `@consumes` | Event consumed | `@consumes OrderPlaced` |
| `@exposes` | HTTP endpoint | `@exposes POST /api/users` |
| `@calls` | External API | `@calls PaymentGateway.charge` |
| `@reads` | Database read | `@reads orders, users` |
| `@writes` | Database write | `@writes orders` |
| `@queue` | Message queue | `@queue order-events` |
| `@repo` | Repository | `@repo github.com/org/service` |

## CLI Commands

### `contract-graph query`

Query contracts by file or ID.

```bash
contract-graph query --file src/users/create.ts
contract-graph query --contract User.create
contract-graph query --type event
contract-graph query --invariants
```

### `contract-graph impact`

Analyze impact of changing a contract.

```bash
contract-graph impact User.create
contract-graph impact Events.OrderPlaced --max-depth 5
```

### `contract-graph validate`

Validate contracts for CI integration.

```bash
contract-graph validate
contract-graph validate --strict
contract-graph validate --check-locations
contract-graph validate --base main  # Detect breaking changes
contract-graph validate --github-actions  # Output annotations
```

### `contract-graph docs`

Generate documentation.

```bash
contract-graph docs --output docs/contracts.md
contract-graph docs --claude  # Generate CLAUDE.md format
```

### `contract-graph init`

Initialize contract-graph in a project.

```bash
contract-graph init
```

## CI Integration

Add to your CI pipeline:

```yaml
# .github/workflows/contracts.yml
name: Contract Validation

on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx contract-graph validate --github-actions --base origin/main
```

## Why Contract Graph?

Traditional tests focus on implementation correctness, not on communicating **invisible dependencies** to agents:

- An async function publishes an event → a consumer in another service depends on its schema
- A database table is read by multiple services with no shared code
- An API endpoint is called by external clients you don't control
- A message queue connects producers and consumers that never "import" each other

Contract Graph captures these relationships so AI agents can:
- Understand the blast radius of changes
- Maintain business invariants
- Coordinate cross-service deployments
- Avoid breaking changes

## License

MIT
