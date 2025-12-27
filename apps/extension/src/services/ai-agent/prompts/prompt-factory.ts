/**
 * Prompt Factory for generating user-facing prompts for AI agents
 * These prompts are used to initialize conversations with users
 */
export const PromptFactory = {
  /**
   * Generate a prompt for planning comprehensive tests across all appropriate test types
   * Focuses on framework detection, file analysis, and multi-level test strategies
   */
  planTestForFile: (filePath: string, workspaceRoot?: string): string => {
    // Convert absolute path to relative if workspace root is provided
    const relativePath =
      workspaceRoot && filePath.startsWith(workspaceRoot)
        ? filePath.slice(workspaceRoot.length).replace(/^\//, "")
        : filePath;

    return `<goal>Analyze the file and output a comprehensive test strategy proposal in the structured format defined in your system prompt.</goal>

<file>${relativePath}</file>

<context>
A knowledge base may exist at .clive/knowledge/ with architecture, user journeys, 
components, and testing patterns. If available, leverage this context to propose 
more informed tests.
</context>

<output_format_requirements>
You MUST output your proposal using the structured format with:
- YAML frontmatter (name, overview, todos)
- Problem Summary section (testing gaps/risks)
- Implementation Plan with numbered sections
- File path as markdown link: [\`${relativePath}\`](${relativePath})
- Line number references (Lines X-Y) when describing code sections
- Changes Summary footer

Reference specific line numbers from the file when describing what needs testing.
</output_format_requirements>

Analyze the file and propose comprehensive test strategies in the structured format. Follow the workflow defined in your system prompt.`;
  },

  /**
   * Generate a prompt for analyzing a changeset (multiple files) and proposing a consolidated test plan
   */
  planTestForChangeset: (
    filePaths: string[],
    workspaceRoot?: string,
  ): string => {
    // Convert absolute paths to relative if workspace root is provided
    const relativeFiles = workspaceRoot
      ? filePaths.map((f) =>
          f.startsWith(workspaceRoot)
            ? f.slice(workspaceRoot.length).replace(/^\//, "")
            : f,
        )
      : filePaths;
    const fileList = relativeFiles.map((f) => `- ${f}`).join("\n");
    return `<goal>Analyze this changeset as a WHOLE and propose ONE consolidated test plan. Do NOT analyze each file separately.</goal>

<files>
${fileList}
</files>

<instructions>
**CRITICAL: Be concise. Avoid repetition.**

Analyze relationships - How do these files work together? What feature/flow do they implement?
Propose ONE consolidated plan using the structured format defined in your system prompt.

**Output Format Requirements:**

\`\`\`markdown
---
name: Test Plan for [Feature Name]
overview: Brief 2-3 sentence summary of what these files do together
todos: ["unit-tests", "integration-tests", "e2e-tests"]  # List test types to be created
---

# Test Plan for [Feature Name]

## Problem Summary

N testing gaps/risks identified across the changeset:

1. **Gap description** - What's missing or at risk (reference files and line numbers)
2. **Gap description** - What's missing or at risk (reference files and line numbers)
3. **Gap description** - What's missing or at risk (reference files and line numbers)

## Implementation Plan

### 1. [Test Category Name - e.g., "Unit Tests for Core Logic"]

**File**: [\`path/to/file1.ts\`](path/to/file1.ts)
**Issue**: Description of the testing gap (reference lines X-Y if applicable)
**Solution**: What tests will be created and why

Lines to cover:
- Lines X-Y: [description of what needs testing]
- Lines A-B: [description of what needs testing]

**File**: [\`path/to/file2.ts\`](path/to/file2.ts)
**Issue**: Description of the testing gap (reference lines X-Y if applicable)
**Solution**: What tests will be created and why

Lines to cover:
- Lines X-Y: [description of what needs testing]

### 2. [Test Category Name - e.g., "Integration Tests for Feature Flow"]
...

## Changes Summary

- **[Category]**: X tests for [description] - covers [files]
- **[Category]**: Y tests for [description] - covers [files]
- **Total**: N tests across [test types]
\`\`\`

**Key Requirements:**
- Use YAML frontmatter with name, overview, todos
- Problem Summary should identify gaps across the entire changeset
- Implementation Plan sections should group by test category/type, not by individual file
- Each Implementation Plan section can reference multiple files if they're part of the same test category
- Include line number references (Lines X-Y) when describing code sections
- Use markdown links for all file paths: [\`relative/path/to/file.ts\`](relative/path/to/file.ts)
- Changes Summary should reference which files each category covers

Keep the entire output concise but comprehensive. Follow the workflow defined in your system prompt.
</instructions>`;
  },
} as const;

