/**
 * Workspace Context Section
 * Path resolution and workspace conventions
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const workspaceContext: Section = (_config) =>
  Effect.succeed(
    `<workspace_context>
**Path Resolution**

Commands execute from workspace root automatically. Use relative paths for best results.

**Best Practices:**
- Use relative paths from workspace root: \\\`npx vitest run apps/nextjs/src/test.tsx\\\`
- Commands run with workspace root as current working directory
- Analyze project structure to understand where test files should be placed
- Look at existing test files to understand project conventions
- Use writeTestFile with relative paths - it will create directories as needed

**Understanding Project Structure:**
- Use bashExecute to explore: \\\`find . -name "*.test.*" -o -name "*.spec.*"\\\` to find existing test patterns
- Check package.json for test scripts and framework configuration
- Look for test directories (__tests__, tests, spec, etc.) to understand conventions
- Create test files in locations that match the project's existing patterns
</workspace_context>`,
  );
