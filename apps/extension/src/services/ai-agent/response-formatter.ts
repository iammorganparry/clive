/**
 * Response formatting utilities for file edit operations
 * Formats responses sent back to the model with final content and change information
 */

export interface FileEditResponse {
  success: boolean;
  filePath: string;
  message: string;
  finalContent?: string;
  userEdits?: string;
  autoFormattingEdits?: string;
  newProblemsMessage?: string;
}

/**
 * Format response for file edit with user changes
 */
export function formatFileEditWithUserChanges(
  filePath: string,
  finalContent: string,
  userEdits: string,
  autoFormattingEdits?: string,
  newProblemsMessage?: string,
): string {
  let response = `The content was successfully saved to ${filePath}.\n\n`;
  response += `The user made the following changes to your edits before approving:\n\n`;
  response += `${userEdits}\n\n`;

  if (autoFormattingEdits) {
    response += `Along with your edits, the user's editor applied the following auto-formatting to your content:\n\n`;
    response += `${autoFormattingEdits}\n\n`;
  }

  response += `Here is the full, updated content of the file that was saved:\n\n`;
  response += `<final_file_content path="${filePath}">\n`;
  response += `${finalContent}`;
  response += `</final_file_content>\n\n`;
  response += `IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any user modifications and auto-formatting.\n`;

  if (newProblemsMessage) {
    response += `\n${newProblemsMessage}\n`;
  }

  return response;
}

/**
 * Format response for file edit without user changes
 */
export function formatFileEditWithoutUserChanges(
  filePath: string,
  finalContent: string,
  autoFormattingEdits?: string,
  newProblemsMessage?: string,
): string {
  let response = `The content was successfully saved to ${filePath}.\n\n`;

  if (autoFormattingEdits) {
    response += `Along with your edits, the user's editor applied the following auto-formatting to your content:\n\n`;
    response += `${autoFormattingEdits}\n\n`;
    response += `(Note: Pay close attention to changes such as single quotes being converted to double quotes, semicolons being removed or added, long lines being broken into multiple lines, adjusting indentation style, adding/removing trailing commas, etc. This will help you ensure future SEARCH/REPLACE operations to this file are accurate.)\n\n`;
  }

  response += `Here is the full, updated content of the file that was saved:\n\n`;
  response += `<final_file_content path="${filePath}">\n`;
  response += `${finalContent}`;
  response += `</final_file_content>\n\n`;
  response += `IMPORTANT: For any future changes to this file, use the final_file_content shown above as your reference. This content reflects the current state of the file, including any auto-formatting that was applied.\n`;

  if (newProblemsMessage) {
    response += `\n${newProblemsMessage}\n`;
  }

  return response;
}

/**
 * Format error response for file edit failure
 */
export function formatFileEditError(
  filePath: string,
  error: string,
  originalContent?: string,
): string {
  let response = `The file edit operation failed for ${filePath}.\n\n`;
  response += `<error>\n${error}\n</error>\n\n`;

  if (originalContent !== undefined) {
    response += `Here is the current content of the file:\n\n`;
    response += `<file_content path="${filePath}">\n`;
    response += `${originalContent}`;
    response += `</file_content>\n\n`;
    response += `Please review the file content and try again with a corrected SEARCH/REPLACE block.\n`;
  }

  return response;
}

/**
 * Format response from SaveChangesResult
 */
export function formatFileEditResponse(
  filePath: string,
  saveResult: {
    finalContent: string;
    userEdits?: string;
    autoFormattingEdits?: string;
    newProblemsMessage?: string;
  },
): string {
  if (saveResult.userEdits) {
    return formatFileEditWithUserChanges(
      filePath,
      saveResult.finalContent,
      saveResult.userEdits,
      saveResult.autoFormattingEdits,
      saveResult.newProblemsMessage,
    );
  } else {
    return formatFileEditWithoutUserChanges(
      filePath,
      saveResult.finalContent,
      saveResult.autoFormattingEdits,
      saveResult.newProblemsMessage,
    );
  }
}

