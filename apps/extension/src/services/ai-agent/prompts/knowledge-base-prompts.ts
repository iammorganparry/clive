/**
 * Prompt factory for Knowledge Base Agent
 * Provides prompts for exploring and documenting codebases
 */
export const KnowledgeBasePromptFactory = {
  /**
   * Generate a prompt for exploring and documenting a codebase
   * Agent-driven exploration with loose guidance
   */
  exploreCodebase: (): string => {
    return `<your_task>
Deeply explore and document this codebase. Your goal is to build a comprehensive 
knowledge base that will help a testing agent write intelligent, high-value tests.

**CRITICAL: Focus on HOT CODE - actively used, recently modified code. Skip stale 
technical debt, deprecated patterns, and unused testing frameworks.**

## Exploration Phases (execute sequentially)

### Phase 1: System Architecture (Steps 1-30)
- Map the overall system architecture
- Identify module boundaries and responsibilities
- Document data flow between major components
- Trace request/response cycles
- Map state management patterns

### Phase 2: Core Components (Steps 31-60)
- Deep dive into key components and services
- Document component interfaces and contracts
- Identify critical business logic
- Map component dependencies
- Include concrete code examples

### Phase 3: Testing Infrastructure (Steps 61-90)
- Analyze existing test patterns and frameworks
- Document test utilities, fixtures, and mocks
- Identify test setup and teardown patterns
- Map test data generation strategies
- Document environment requirements

### Phase 4: Integration Points (Steps 91-120)
- Document external service integrations
- Identify API contracts and data models
- Map database interactions and queries
- Document authentication/authorization flows
- Identify configuration requirements

### Phase 5: Deep Analysis (Steps 121-150)
- Identify testing gaps and opportunities
- Document edge cases and error handling
- Map security patterns
- Document performance considerations
- Create comprehensive test recommendations

## Documentation Standards

For EACH knowledge file you create:

1. **Context**: Why this is important for testing
2. **Overview**: Clear explanation of the concept/pattern
3. **Code Examples**: Minimum 2-3 real code examples from the codebase
4. **Usage Patterns**: How it's used across the codebase
5. **Test Implications**: What tests need to cover this
6. **Edge Cases**: Known edge cases or error scenarios
7. **Related Patterns**: Links to related knowledge articles

Aim for 300-500 words per article with substantial code examples.

Use writeKnowledgeFile to store your discoveries as you go. Don't wait until 
the end - document incrementally so knowledge is preserved even if exploration 
is interrupted.
</your_task>

<phase_0_enhanced_discovery>
**MANDATORY FIRST PHASE: Comprehensive Hot Code Discovery**

Before deep exploration, identify what code is actively used vs stale technical debt:

1. **Find recently modified files** (prioritize by modification frequency):
   - Run: git log --name-only --since="3 months ago" --pretty=format: | sort | uniq -c | sort -rn | head -50
   - Run: git log --name-only --since="1 month ago" --pretty=format: | sort | uniq -c | sort -rn | head -30
   - Document: Top 50 most active files with modification counts
   - Run: git log --format='%H' --since="6 months ago" -- <directory> | head -1
   - If no commits found, this area is stale - skip it

2. **Analyze import dependencies** (find critical modules):
   - Find TypeScript/JavaScript entry points: cat package.json | grep -E "(main|exports|bin)"
   - Map import graph: grep -rh "^import.*from" --include="*.ts" --include="*.tsx" | sort | uniq -c | sort -rn | head -100
   - Document: Top 30 most imported modules (core infrastructure)
   - Files imported by 3+ other files are core code (prioritize)
   - Files with zero imports may be orphaned (deprioritize)

3. **Identify API routes and endpoints**:
   - Find route definitions: grep -r "router|app.(get|post|put|delete)" --include="*.ts" --include="*.js"
   - Find tRPC procedures: grep -r "procedure|router" --include="*.ts" | grep -E "(query|mutation|subscription)"
   - Document: All public API endpoints with their handlers

4. **Map data models and schemas**:
   - Find database schemas: find . -name "schema.ts" -o -name "models.ts" -o -name "*.model.ts"
   - Find validation schemas: grep -r "z.object|yup|joi" --include="*.ts"
   - Document: All data models with their fields and validations

5. **Analyze test coverage**:
   - Find test files: find . -name "*.test.ts" -o -name "*.spec.ts" | wc -l
   - Find coverage for hot files: for each top file, check if test exists
   - Identify testing gaps: which hot files lack tests?

**Create "hot-code-map" article summarizing findings before proceeding to Phase 1**
</phase_0_enhanced_discovery>

<discovery_tools>
Use bashExecute extensively for file discovery:
- \`find\` - Locate files by pattern
- \`grep\` - Search file contents
- \`cat\` - Read file contents
- \`wc -l\` - Count lines
- \`git log\` - Analyze commit history
- \`head/tail\` - Sample file sections
- Combine commands with pipes for powerful queries

Start broad, then dive deep based on what you discover.
</discovery_tools>

<categories>
Store knowledge in these categories (use writeKnowledgeFile):
- architecture: System design, module structure, data flow
- components: UI components, services, utilities
- user-journeys: User workflows, feature flows
- test-patterns: Test utilities, fixtures, patterns  
- api-integrations: External services, API contracts
- patterns: Code patterns, best practices
</categories>

Proceed with Phase 0, then Phases 1-5. Be thorough - this knowledge base is critical 
for enabling intelligent test generation.`;
  },
} as const;
