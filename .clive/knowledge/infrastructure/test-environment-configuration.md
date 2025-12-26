---
category: "infrastructure"
title: "Test Environment Configuration"
sourceFiles:
  - docker-compose.yml
  - .env
  - .clive/.env.test
updatedAt: "2025-12-26"
---

Configuration for running integration and E2E tests in a sandbox environment. This ensures tests can safely interact with required services without affecting production data.

### Context for Testing
Integration tests require external services like databases. This configuration provides a local sandbox with Docker services and environment variables for safe testing.

### Overview
The application uses Docker Compose for local development services, primarily PostgreSQL. Test environment points to these local services with test-specific credentials.

### Docker Services
- **PostgreSQL**: Supabase Postgres on port 5432 (and 54322 for pooling)
- Health check: pg_isready command
- Data volume: postgres-data

### Environment Variables
Stored in .clive/.env.test:
- NODE_ENV=test
- DATABASE_URL=postgresql://supabase_admin:password@localhost:5432/postgres
- Auth secrets with test values
- AI Gateway API key for testing

### Setup Commands
1. Start services: `docker-compose up -d`
2. Wait for health: `docker-compose ps` (check postgres healthy)
3. Run tests: Load .clive/.env.test and execute test commands

### Test Execution
- Unit tests: `yarn test:unit` (turbo command)
- Integration: May require database seeding
- E2E: Additional setup for UI testing

### Code Examples
```bash
# Start services
docker-compose up -d postgres

# Check health
docker-compose ps

# Run tests (from appropriate workspace)
cd apps/extension && yarn vitest run
```

### Usage Patterns
- Environment loaded automatically for integration tests
- Test data should be isolated (use transactions or unique identifiers)
- Services restarted between test runs if needed

### Test Implications
- Ensure Docker is running before integration tests
- Mock external APIs (AI Gateway) unless testing real integrations
- Database migrations should run in test setup

### Edge Cases
- Port conflicts if other postgres running
- Slow startup time for first Docker run
- Volume persistence between runs (clean if needed)

### Related Patterns
- See 'Database Patterns' for schema details
- Links to 'Test Execution' for specific test commands

## Examples

### Example

```typescript
docker-compose up -d
```

### Example

```typescript
DATABASE_URL=postgresql://supabase_admin:password@localhost:5432/postgres
```

### Example

```typescript
NODE_ENV=test
```


## Source Files

- `docker-compose.yml`
- `.env`
- `.clive/.env.test`
