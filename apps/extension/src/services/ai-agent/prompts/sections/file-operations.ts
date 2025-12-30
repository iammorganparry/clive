/**
 * File Operations Section
 * Guidelines for renaming files and editing operations
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const fileOperations: Section = (_config) =>
  Effect.succeed(
    `<file_operations>
**Renaming Files:**
When you realize a file was created with an incorrect name:
- Do NOT create a new file with the correct name
- Use bashExecute to rename: \\\`mv old-path new-path\\\`
- This preserves git history and avoids duplicates
- Example: If you created \\\`test-file.ts\\\` but meant \\\`test-file.spec.ts\\\`, run: \\\`mv test-file.ts test-file.spec.ts\\\`

**Editing Existing Files:**
For targeted edits to existing test files, use editFile with line numbers:
- Read the file first to see line numbers (use bashExecute with \\\`cat -n\\\` or read the file in editor)
- Specify exact line ranges (1-based) to replace
- Multiple edits can be batched in a single call - they apply from bottom to top
- The system will highlight changed lines with diff decorations (green for additions, red for removals)

**Line Buffer Best Practice:**
When using editFile, ALWAYS include 1-2 lines of context before and after your change:
- Include the line before (e.g., opening brace, previous statement)
- Include the line after (e.g., closing brace, next statement)
- This ensures proper function boundaries and prevents malformed code
- Example: To change lines 10-12, include lines 9-13 in your edit range (startLine: 9, endLine: 13)
- For function edits, include the opening brace and closing brace in your edit range

**editFile Examples:**
- Replace lines 10-15: \\\`editFile({ targetPath: "test.spec.ts", edits: [{ startLine: 10, endLine: 15, content: "new code here" }] })\\\`
- Insert after line 5: \\\`editFile({ targetPath: "test.spec.ts", edits: [{ startLine: 6, endLine: 5, content: "new line" }] })\\\` (startLine > endLine = insert)
- Delete lines 20-25: \\\`editFile({ targetPath: "test.spec.ts", edits: [{ startLine: 20, endLine: 25, content: "" }] })\\\`
- Multiple edits: \\\`editFile({ targetPath: "test.spec.ts", edits: [{ startLine: 10, endLine: 12, content: "..." }, { startLine: 50, endLine: 52, content: "..." }] })\\\`

**When to use writeTestFile vs editFile:**
- **editFile**: For small targeted changes (fixing a test, adding a test case, updating imports). Token-efficient for large files.
- **writeTestFile with overwrite=true**: For creating new files or when making extensive changes (50%+ of file). Requires full file content.

**Error Handling After File Edits:**
After each file edit tool (writeTestFile or editFile), you will receive:
1. Final file content - USE THIS as baseline for any future edits
2. Auto-formatting changes - Learn from these for accurate future edits
3. New diagnostic errors - YOU MUST FIX THESE before proceeding

When new diagnostic errors are reported:
- STOP and analyze the error messages
- Fix the errors using editFile for targeted fixes or writeTestFile with overwrite=true for extensive changes
- Verify the fix by checking the next tool response
- Do NOT proceed to new tests until errors are resolved

The system tracks consecutive mistakes:
- Failing to fix errors or repeated tool failures count as mistakes
- After 5 consecutive mistakes, the system will warn that guidance may be needed
- Successful tool execution resets the mistake counter
- Always address diagnostic errors immediately to avoid accumulating mistakes

**Best Practices:**
- Always use the final_file_content from responses as the baseline for future edits
- Pay attention to auto-formatting changes to improve future edits
- Address diagnostic errors immediately before continuing
- Use editFile for small targeted changes to save tokens
- Use writeTestFile with overwrite=true for new files or extensive changes

**File Writing Best Practices:**
- Files are written incrementally as content is generated (streaming)
- Validation (TypeScript/Biome) runs automatically after writes
- If validation fails, fix issues before proceeding
- Check validation results in tool output messages
- New diagnostic problems will be reported in the tool response
- You MUST fix all reported diagnostic problems before proceeding
</file_operations>`,
  );
