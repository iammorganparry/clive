---
name: effect-ts
description: Expert guidance on Effect-TS patterns, error handling, services, layers, and dependency injection. Use when writing backend services, working with Effect code, or needing help with typed effects, error handling, or service patterns.
allowed-tools: Read, Glob, Grep, Write, Edit
---

# Effect-TS Master

Comprehensive guide to Effect-TS patterns used in this codebase. All backend services MUST use Effect-TS.

## The Effect Type

```typescript
Effect<Success, Error, Requirements>
```

- **Success**: The type returned on success
- **Error**: The typed error channel (union of possible errors)
- **Requirements**: Dependencies needed (services via Context)

## Creating Effects

### Success and Failure

```typescript
import { Effect } from "effect"

// Create a successful effect
const success = Effect.succeed(42)
// Effect<number, never, never>

// Create a failed effect
const failure = Effect.fail(new Error("Something went wrong"))
// Effect<never, Error, never>
```

### From Synchronous Code

```typescript
// For pure synchronous code that never fails
const sync = Effect.sync(() => Date.now())

// For synchronous code that might throw
const trySync = Effect.try({
  try: () => JSON.parse(rawJson),
  catch: (error) => new ParseError({ cause: error })
})
```

### From Promises (Effect.tryPromise)

```typescript
import { Effect } from "effect"

// Wrap async operations with typed errors
const fetchUser = (id: string) =>
  Effect.tryPromise({
    try: () => fetch(`/api/users/${id}`).then(r => r.json()),
    catch: (error) => new FetchError({ message: "Failed to fetch user", cause: error })
  })
```

## Generator Syntax (Effect.gen)

The recommended way to write Effect code. Uses generators for sequential, readable code.

```typescript
import { Effect } from "effect"

const program = Effect.gen(function* () {
  // yield* to "await" effects
  const user = yield* fetchUser("123")
  const posts = yield* fetchPosts(user.id)

  // Can use regular JS
  const filtered = posts.filter(p => p.published)

  // Log with Effect.log
  yield* Effect.log(`Found ${filtered.length} posts`)

  return filtered
})
```

### Conditional Logic in Generators

```typescript
const program = Effect.gen(function* () {
  const config = yield* Config

  if (config.featureFlag) {
    yield* doNewThing()
  } else {
    yield* doOldThing()
  }

  return "done"
})
```

## Error Handling

### Defining Custom Errors with Data.TaggedError

```typescript
import { Data } from "effect"

// Define typed errors with automatic _tag
export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  readonly message: string
  readonly entityId: string
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly message: string
  readonly field: string
}> {}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
```

### Catching Specific Errors

```typescript
import { Effect } from "effect"

// Catch a specific error by tag
const handled = program.pipe(
  Effect.catchTag("NotFoundError", (error) =>
    Effect.succeed({ fallback: true, message: error.message })
  )
)

// Catch multiple error types
const recovered = program.pipe(
  Effect.catchTags({
    NotFoundError: (e) => Effect.succeed(null),
    ValidationError: (e) => Effect.fail(new UserFacingError(e.message)),
    DatabaseError: (e) => Effect.die(e) // Convert to defect
  })
)
```

### Catching All Errors

```typescript
// Catch all errors
const safe = program.pipe(
  Effect.catchAll((error) => Effect.succeed({ error: error.message }))
)

// Transform error type
const mapped = program.pipe(
  Effect.mapError((error) => new WrappedError({ cause: error }))
)
```

### Error Pattern: tryPromise with Typed Errors

```typescript
const callExternalApi = (url: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response.json()
    },
    catch: (error) => new ApiError({
      message: "External API call failed",
      cause: error
    })
  })
```

## Services and Dependency Injection

### Defining a Service with Context.Tag

```typescript
import { Context, Effect, Layer } from "effect"

// 1. Define the service interface and tag
class UserRepository extends Context.Tag("UserRepository")<
  UserRepository,
  {
    readonly findById: (id: string) => Effect.Effect<User | null, DatabaseError>
    readonly save: (user: User) => Effect.Effect<void, DatabaseError>
  }
>() {}
```

### Creating Layers

```typescript
// 2. Create a layer (implementation)
const UserRepositoryLive = Layer.succeed(UserRepository, {
  findById: (id) => Effect.tryPromise({
    try: () => prisma.user.findUnique({ where: { id } }),
    catch: (e) => new DatabaseError({ message: "Find failed", cause: e })
  }),
  save: (user) => Effect.tryPromise({
    try: () => prisma.user.update({ where: { id: user.id }, data: user }),
    catch: (e) => new DatabaseError({ message: "Save failed", cause: e })
  })
})
```

### Using Services

```typescript
// 3. Use the service in your program
const getUser = (id: string) =>
  Effect.gen(function* () {
    const repo = yield* UserRepository
    const user = yield* repo.findById(id)
    if (!user) {
      return yield* Effect.fail(new NotFoundError({
        message: "User not found",
        entityId: id
      }))
    }
    return user
  })
```

### Providing Services

```typescript
// 4. Provide the layer to run the program
const runnable = Effect.provide(getUser("123"), UserRepositoryLive)

Effect.runPromise(runnable)
```

## Effect.Service Pattern (Recommended)

Combines Tag and Layer in a single definition. This is the pattern used in `@trigify/services`.

```typescript
import { Effect, Context, Layer } from "effect"

// Dependencies
class Database extends Context.Tag("Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<unknown[]> }
>() {}

// Service definition with dependencies
export class UserService extends Effect.Service<UserService>()("UserService", {
  // Use effect: for async/effectful initialization
  effect: Effect.gen(function* () {
    // Get dependencies
    const db = yield* Database

    // Return service implementation
    return {
      findById: (id: string) =>
        Effect.gen(function* () {
          const results = yield* db.query(`SELECT * FROM users WHERE id = '${id}'`)
          return results[0] as User | undefined
        }),

      create: (data: CreateUserInput) =>
        Effect.gen(function* () {
          yield* Effect.log(`Creating user: ${data.email}`)
          // ... implementation
        })
    }
  }),

  // Declare dependencies
  dependencies: [DatabaseLive]
}) {}

// Or use sync: for synchronous initialization
export class ConfigService extends Effect.Service<ConfigService>()("ConfigService", {
  sync: () => ({
    apiUrl: process.env.API_URL ?? "http://localhost:3000",
    debug: process.env.DEBUG === "true"
  })
}) {}
```

### Using Effect.Service with Accessors

```typescript
export class Logger extends Effect.Service<Logger>()("Logger", {
  accessors: true, // Generates static methods
  effect: Effect.gen(function* () {
    return {
      info: (message: string) => Effect.log(message),
      error: (message: string) => Effect.logError(message)
    }
  })
}) {}

// With accessors: true, you can call directly
const program = Effect.gen(function* () {
  yield* Logger.info("Hello world")
})

// Instead of
const program2 = Effect.gen(function* () {
  const logger = yield* Logger
  yield* logger.info("Hello world")
})
```

## Running Effects

### In Application Code

```typescript
// Run and get Promise
Effect.runPromise(program)
  .then(result => console.log(result))
  .catch(error => console.error(error))

// Run synchronously (only for sync effects)
const result = Effect.runSync(syncProgram)

// Run and get Exit (success or failure)
const exit = await Effect.runPromiseExit(program)

if (Exit.isSuccess(exit)) {
  console.log(exit.value)
} else {
  console.error(exit.cause)
}
```

### In tRPC Routes

```typescript
import { Effect } from "effect"

export const userRouter = createTRPCRouter({
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const program = Effect.gen(function* () {
        const userService = yield* UserService
        return yield* userService.findById(input.id)
      }).pipe(
        Effect.provide(UserServiceLive)
      )

      return Effect.runPromise(program)
    })
})
```

## Common Patterns in This Codebase

### Service with Prisma

```typescript
export class CompanyService extends Effect.Service<CompanyService>()("CompanyService", {
  effect: Effect.gen(function* () {
    const prisma = yield* PrismaClient

    return {
      findById: (id: string) =>
        Effect.tryPromise({
          try: () => prisma.company.findUnique({ where: { id } }),
          catch: (e) => new DatabaseError({ message: "Failed to find company", cause: e })
        }),

      create: (data: CreateCompanyInput) =>
        Effect.tryPromise({
          try: () => prisma.company.create({ data }),
          catch: (e) => new DatabaseError({ message: "Failed to create company", cause: e })
        })
    }
  }),
  dependencies: [PrismaClientLive]
}) {}
```

### Service with External API

```typescript
export class LinkedInService extends Effect.Service<LinkedInService>()("LinkedInService", {
  effect: Effect.gen(function* () {
    const config = yield* ConfigService
    const http = yield* HttpClient

    return {
      getProfile: (url: string) =>
        Effect.gen(function* () {
          yield* Effect.log(`Fetching LinkedIn profile: ${url}`)

          const response = yield* http.get(
            `${config.linkedInApiUrl}/profile`,
            { params: { url } }
          ).pipe(
            Effect.mapError(e => new LinkedInApiError({ cause: e }))
          )

          return response.data as LinkedInProfile
        })
    }
  }),
  dependencies: [ConfigServiceLive, HttpClientLive]
}) {}
```

### Composing Multiple Services

```typescript
const enrichProspect = (prospectId: string) =>
  Effect.gen(function* () {
    const prospectService = yield* ProspectService
    const enrichmentService = yield* EnrichmentService
    const creditService = yield* CreditService

    // Check credits first
    yield* creditService.reserveCredits(1)

    // Get prospect
    const prospect = yield* prospectService.findById(prospectId)
    if (!prospect) {
      return yield* Effect.fail(new NotFoundError({ entityId: prospectId }))
    }

    // Enrich
    const enriched = yield* enrichmentService.enrich(prospect)

    // Save
    yield* prospectService.update(prospectId, enriched)

    return enriched
  })
```

## Logging

```typescript
import { Effect } from "effect"

Effect.gen(function* () {
  // Basic logging
  yield* Effect.log("Info message")
  yield* Effect.logDebug("Debug message")
  yield* Effect.logWarning("Warning message")
  yield* Effect.logError("Error message")

  // With structured data
  yield* Effect.log("Processing user").pipe(
    Effect.annotateLogs({ userId: "123", action: "enrich" })
  )
})
```

## Pipe vs Generator

### Use Generators For:
- Sequential operations
- Complex business logic
- When you need intermediate variables
- Better readability

### Use Pipe For:
- Simple transformations
- Chaining operators
- One-liner compositions

```typescript
// Pipe style - good for simple chains
const result = fetchUser(id).pipe(
  Effect.map(user => user.name),
  Effect.mapError(e => new WrappedError({ cause: e })),
  Effect.tap(name => Effect.log(`Found: ${name}`))
)

// Generator style - good for complex logic
const result2 = Effect.gen(function* () {
  const user = yield* fetchUser(id)
  if (user.status === "inactive") {
    return yield* Effect.fail(new InactiveUserError())
  }
  yield* Effect.log(`Found: ${user.name}`)
  const posts = yield* fetchPosts(user.id)
  return { user, posts }
})
```

## Testing with Effect

```typescript
import { Effect, Layer } from "effect"
import { describe, it, expect } from "vitest"

// Create test layer with mock
const MockUserRepository = Layer.succeed(UserRepository, {
  findById: (id) => Effect.succeed({ id, name: "Test User" }),
  save: () => Effect.succeed(undefined)
})

describe("UserService", () => {
  it("should find user by id", async () => {
    const program = Effect.gen(function* () {
      const service = yield* UserService
      return yield* service.findById("123")
    }).pipe(
      Effect.provide(MockUserRepository)
    )

    const result = await Effect.runPromise(program)
    expect(result.name).toBe("Test User")
  })
})
```

## Quick Reference

| Operation | Code |
|-----------|------|
| Create success | `Effect.succeed(value)` |
| Create failure | `Effect.fail(error)` |
| Wrap promise | `Effect.tryPromise({ try: () => ..., catch: (e) => ... })` |
| Wrap sync | `Effect.try({ try: () => ..., catch: (e) => ... })` |
| Pure sync | `Effect.sync(() => ...)` |
| Transform value | `effect.pipe(Effect.map(x => ...))` |
| Transform error | `effect.pipe(Effect.mapError(e => ...))` |
| Catch by tag | `effect.pipe(Effect.catchTag("Tag", e => ...))` |
| Catch all | `effect.pipe(Effect.catchAll(e => ...))` |
| Log | `yield* Effect.log("message")` |
| Get service | `yield* ServiceTag` |
| Provide layer | `effect.pipe(Effect.provide(layer))` |
| Run to promise | `Effect.runPromise(effect)` |

## Resources

- Effect-TS Docs: https://effect.website/docs/
- Effect GitHub: https://github.com/Effect-TS/effect
- This codebase: `packages/services/src/` for examples
