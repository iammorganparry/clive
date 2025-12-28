/**
 * Prompt Factory for generating user-facing prompts for AI agents
 * These prompts are used to initialize conversations with users
 */
export const PromptFactory = {
  /**
   * Generate a prompt for planning comprehensive tests for a single file
   */
  planTestForFile: (filePath: string, workspaceRoot?: string): string => {
    // Convert absolute path to relative if workspace root is provided
    const relativePath =
      workspaceRoot && filePath.startsWith(workspaceRoot)
        ? filePath.slice(workspaceRoot.length).replace(/^\//, "")
        : filePath;

    return `Analyze this file and propose a comprehensive test strategy:

File: ${relativePath}

Focus on identifying testing gaps, risks, and opportunities. Propose a structured test plan using the format defined in your system prompt.`;
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
    
    return `Analyze this changeset as a WHOLE and propose ONE consolidated test plan:

Files:
${fileList}

Analyze how these files work together, what feature/flow they implement, and propose a comprehensive test strategy using the format defined in your system prompt. Group tests by feature/flow, not by individual file.`;
  },
} as const;


