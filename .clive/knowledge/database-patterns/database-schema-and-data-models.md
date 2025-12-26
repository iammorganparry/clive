---
category: "database-patterns"
title: "Database Schema and Data Models"
sourceFiles:
  - packages/db/src/schema.ts
updatedAt: "2025-12-26"
---

The database schema defines the core data models for the application, using Drizzle ORM with PostgreSQL. This schema supports user authentication, organizations, AI conversations, codebase indexing with embeddings, and a testing knowledge base. Understanding these models is crucial for writing integration tests that interact with the database safely.

### Context for Testing
Database models represent the persistence layer. Tests should validate data integrity, relationships, and migrations. Integration tests may need to seed data or mock database interactions to avoid affecting production data.

### Overview
The schema uses Drizzle ORM for type-safe database operations and includes Zod schemas for validation. Key entities include users (via Better Auth), conversations for AI interactions, repositories and files for codebase indexing, and a knowledge base for testing insights.

### Core Data Models
- **User Management**: user, session, account, verification, jwks (Better Auth standard tables)
- **Organizations**: organization, member, invitation (multi-tenant support)
- **Conversations**: conversation, conversationMessage (AI chat history)
- **Codebase Indexing**: repositories, files (with vector embeddings for semantic search)
- **Knowledge Base**: knowledgeBase (categorized testing knowledge with embeddings)

### Code Examples
```typescript
export const conversation = pgTable("conversation", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  status: conversationStatusEnum("status").notNull().default("planning"),
  // ...
});

export const knowledgeBase = pgTable("knowledge_base", {
  id: text("id").primaryKey(),
  repositoryId: text("repository_id").notNull().references(() => repositories.id),
  category: knowledgeBaseCategoryEnum("category").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
  // ...
});
```

### Usage Patterns
- Conversations track AI agent interactions with status progression (planning → confirmed → completed).
- Files table stores codebase content with embeddings for semantic search.
- Knowledge base categorizes testing knowledge (framework, patterns, mocks, etc.).

### Test Implications
- Unit tests for schema validation using createInsertSchema.
- Integration tests should use transactions to avoid data pollution.
- Test data builders needed for seeding conversations, files, and knowledge entries.
- Validate foreign key constraints and enum values.

### Edge Cases
- Handling deleted users (cascade deletes).
- Vector embedding dimensions must match (1536 for text-embedding-3-small).
- Content hash changes trigger re-indexing.

### Related Patterns
- See 'API Contracts' for Zod validation in endpoints.
- Links to 'Authentication Patterns' for user/session handling.

## Examples

### Example

```typescript
export const user = pgTable("user", { id: text("id").primaryKey(), name: text("name").notNull(), ... });
```

### Example

```typescript
export const conversationStatusEnum = pgEnum("conversation_status", ["planning", "confirmed", "completed"]);
```

### Example

```typescript
export const CreatePostSchema = createInsertSchema(Post, { title: z.string().max(256), ... });
```


## Source Files

- `packages/db/src/schema.ts`
