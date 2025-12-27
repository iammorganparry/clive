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
For small changes to existing files, prefer replaceInFile over rewriting the entire file:
- More efficient for targeted fixes
- Preserves unchanged content
- Less prone to formatting errors
- Use replaceInFile when:
  - Fixing a single function or method
  - Updating a specific test case
  - Making small corrections
  - Making multiple related changes to the same file
- Use writeTestFile (with overwrite=true) when:
  - Creating a new file
  - Making extensive changes (50%+ of file)
  - Complete rewrite is needed

**replaceInFile SEARCH/REPLACE Format:**
The replaceInFile tool supports multi-block SEARCH/REPLACE format for multiple edits in a single operation:

Use the 'diff' parameter with this format:
\\\`\\\`\\\`
------- SEARCH
[exact content to find in the file]
=======
[new content to replace with]
+++++++ REPLACE
\\\`\\\`\\\`

For multiple edits, include multiple blocks in order:
\\\`\\\`\\\`
------- SEARCH
[first content to find]
=======
[first replacement]
+++++++ REPLACE
------- SEARCH
[second content to find]
=======
[second replacement]
+++++++ REPLACE
\\\`\\\`\\\`

**SEARCH Block Requirements:**
- Must match exactly (character-for-character) including whitespace
- Include complete lines only (don't split lines)
- Include enough context to make the match unique
- Order multiple blocks as they appear in the file (top to bottom)
- Empty SEARCH block means replace entire file (or insert if file is empty)

**Matching Strategy:**
The tool uses three-tier matching:
1. Exact match (character-for-character)
2. Line-trimmed fallback (ignores leading/trailing whitespace per line)
3. Block anchor match (uses first and last lines as anchors for 3+ line blocks)

**Response Format:**
After edits, the tool returns:
- Final file content in <final_file_content> tags - ALWAYS use this as baseline for future edits
- Auto-formatting changes (quotes, semicolons, indentation, etc.) - learn from these
- User edits (if user modified before approving) - incorporate these
- New diagnostic problems (if any) - fix these in next edit

**Error Handling After File Edits:**
After each file write tool (writeTestFile, replaceInFile), you will receive:
1. Final file content - USE THIS as baseline for any future edits
2. Auto-formatting changes - Learn from these for accurate SEARCH blocks
3. New diagnostic errors - YOU MUST FIX THESE before proceeding

When new diagnostic errors are reported:
- STOP and analyze the error messages
- Fix the errors using replaceInFile with targeted SEARCH/REPLACE
- Verify the fix by checking the next tool response
- Do NOT proceed to new tests until errors are resolved

The system tracks consecutive mistakes:
- Failing to fix errors or repeated tool failures count as mistakes
- After 5 consecutive mistakes, the system will warn that guidance may be needed
- Successful tool execution resets the mistake counter
- Always address diagnostic errors immediately to avoid accumulating mistakes

**Best Practices:**
- Default to replaceInFile with 'diff' parameter for most changes
- Batch related changes in a single replaceInFile call with multiple blocks
- Always use the final_file_content from responses as the baseline for future edits
- Pay attention to auto-formatting changes to improve future SEARCH blocks
- Address diagnostic errors immediately before continuing

**File Writing Best Practices:**
- Files are written incrementally as content is generated (streaming)
- Validation (TypeScript/Biome) runs automatically after writes
- If validation fails, fix issues before proceeding
- Check validation results in tool output messages
- New diagnostic problems will be reported in the tool response
- You MUST fix all reported diagnostic problems before proceeding
</file_operations>`,
  );

