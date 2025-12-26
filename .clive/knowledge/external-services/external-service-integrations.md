---
category: "external-services"
title: "External Service Integrations"
sourceFiles:
  - .env
  - packages/db/src/schema.ts
  - apps/extension/src/services/ai-agent/testing-agent.ts
updatedAt: "2025-12-26"
---

Integration with third-party services for AI, authentication, and data persistence. These external dependencies require careful testing to handle failures gracefully.

### Context for Testing
External services introduce network dependencies and API changes. Tests must mock these services while validating error handling and data transformation.

### Overview
The application integrates with AI providers, authentication services, and cloud databases. These integrations use API keys, OAuth flows, and database connections.

### Key Integrations

**AI Services**
- AI Gateway: Custom API for LLM interactions
- Anthropic/XAI: Direct model providers
- Token budgeting and streaming responses

**Authentication**
- Better Auth: User management and sessions
- GitHub OAuth: Social login
- Discord OAuth: Alternative login option

**Database**
- Supabase PostgreSQL: Primary data store
- Drizzle ORM: Type-safe database operations
- Vector extensions: For semantic search

### Integration Patterns
- API key authentication for AI services
- OAuth callbacks for authentication
- Database connection pooling
- Error retry logic for network calls

### Code Examples
```typescript
// AI integration
const response = await streamText({
  model: AIModels.claude,
  prompt: systemPrompt,
  tools: [bashTool, writeTestTool]
});

// Auth integration
const auth = betterAuth({
  providers: [github, discord],
  database: db,
  session: { cookie: true }
});

// Database integration
const result = await db
  .select()
  .from(conversation)
  .where(eq(conversation.userId, userId));
```

### Usage Patterns
- Streaming for real-time AI responses
- Session management with secure cookies
- Transactional database operations
- Vector similarity search for knowledge retrieval

### Test Implications
- Mock AI responses for deterministic testing
- Stub auth providers in integration tests
- Use test database for data operations
- Test error scenarios (rate limits, network failures)
- Validate OAuth callback handling

### Edge Cases
- API key expiration
- Network timeouts
- Rate limiting
- Invalid OAuth tokens
- Database connection failures

### Related Patterns
- See 'Authentication Patterns' for auth flows
- Links to 'Database Patterns' for data operations
- 'AI Agent Architecture' for AI usage

## Examples

### Example

```typescript
await streamText({ model: AIModels.claude, ... });
```

### Example

```typescript
const auth = betterAuth({ providers: [github], ... });
```

### Example

```typescript
await db.select().from(conversation);
```


## Source Files

- `.env`
- `packages/db/src/schema.ts`
- `apps/extension/src/services/ai-agent/testing-agent.ts`
