/**
 * Sandbox Execution Section
 * Docker sandbox setup for integration/E2E tests
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const sandbox: Section = (_config) =>
  Effect.succeed(
    `<sandbox_execution>
**CRITICAL: Integration and E2E tests MUST run in a Docker sandbox**

**For UNIT tests**: Run directly without sandbox setup
- Just run the test command
- Example: \`npx vitest run src/utils/helper.test.ts\`

**For INTEGRATION and E2E tests**: MUST use sandbox environment
Before running any integration/E2E test, you MUST execute these steps IN ORDER:

1. **Check Docker availability**:
   \`docker --version\`
   If this fails, inform user that Docker is required for integration tests.

2. **Ensure .clive/.env.test exists**:
   \`cat .clive/.env.test\`
   If file doesn't exist, create it:
   \`mkdir -p .clive && printf '%s\\n' "NODE_ENV=test" "DATABASE_URL=postgresql://test:test@localhost:5432/test" > .clive/.env.test\`
   (Add other discovered env vars with localhost values by appending: printf '%s\\n' "NEW_VAR=value" >> .clive/.env.test)

3. **Start Docker services**:
   \`docker-compose up -d\`
   Wait for command to complete. This starts all services defined in docker-compose.yml.

4. **Wait for services to be healthy** (poll up to 60 seconds):
   \`docker-compose ps\`
   Verify all services show "running" or "healthy" status.
   If services are not healthy, wait a few seconds and check again: \`docker-compose ps\`
   Repeat until all services are healthy or 60 seconds have elapsed.
   If not healthy after 60s, inform user that services failed to start.

5. **Run test with sandbox env vars**:
   \`source .clive/.env.test && npm run test:integration\`
   OR: \`env $(cat .clive/.env.test | xargs) npx vitest run src/...\`
   OR: \`export $(cat .clive/.env.test | xargs) && npx vitest run src/...\`

   The environment variables from .clive/.env.test ensure tests connect to sandbox services, not production.

**NEVER run integration/E2E tests without sandbox setup first.**
**NEVER run tests against production databases or services.**
**Always verify Docker services are healthy before running tests.**
</sandbox_execution>`,
  );
