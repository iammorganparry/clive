/**
 * Shared types for the AI agent tools and responses
 */

export interface ReadFileInput {
  filePath: string;
}

export interface ReadFileOutput {
  content: string;
  filePath: string;
  exists: boolean;
  wasTruncated?: boolean;
  totalLines?: number;
  returnedLines?: number;
  truncationNote?: string;
}

export interface ListFilesInput {
  directoryPath: string;
  includePattern?: string;
  excludePattern?: string;
}

export interface ListFilesOutput {
  files: Array<{
    path: string;
    relativePath: string;
    isDirectory: boolean;
  }>;
  directoryPath: string;
}

export interface GrepSearchInput {
  pattern: string;
  path?: string;
  fileType?: string;
  maxResults?: number;
}

export interface GrepSearchOutput {
  matches: Array<{
    filePath: string;
    relativePath: string;
    lineNumber: number;
    lineContent: string;
  }>;
  pattern: string;
  totalMatches: number;
}

export interface GlobSearchInput {
  pattern: string;
  excludePattern?: string;
}

export interface GlobSearchOutput {
  files: Array<{
    path: string;
    relativePath: string;
  }>;
  pattern: string;
}

export interface GetCypressConfigInput {
  workspaceRoot?: string;
}

export interface GetCypressConfigOutput {
  config: Record<string, unknown> | null;
  configPath: string | null;
  exists: boolean;
}

export interface GetFileDiffInput {
  filePath: string;
}

export interface GetFileDiffOutput {
  diff: string;
  filePath: string;
  hasChanges: boolean;
}

export interface WriteTestFileInput {
  testContent: string;
  targetPath: string;
  overwrite?: boolean;
}

export interface WriteTestFileOutput {
  success: boolean;
  filePath: string;
  message: string;
}

export interface GenerateTestInput {
  sourceFilePath: string;
  options?: {
    updateExisting?: boolean;
    targetDirectory?: string;
  };
}

export interface GenerateTestOutput {
  success: boolean;
  testFilePath?: string;
  testContent?: string;
  error?: string;
}

export interface ProposedTest {
  id: string;
  sourceFile: string;
  targetTestPath: string;
  description: string;
  isUpdate: boolean;
  proposedContent: string; // The actual test code that will be written
  existingContent?: string; // Current file content (for updates)
  // E2E-specific fields
  navigationPath?: string; // URL/route to navigate to
  pageContext?: string; // Page component containing this feature
  prerequisites?: string[]; // Auth, data setup requirements
  relatedTests?: string[]; // Existing tests that may be impacted
  userFlow?: string; // Description of the E2E user journey
}

export interface TestGenerationPlan {
  tests: ProposedTest[];
}

export type TestExecutionStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "completed"
  | "error";

export interface ProposeTestInput {
  sourceFile: string;
  targetTestPath: string;
  description: string;
  isUpdate: boolean;
  // E2E-specific fields
  navigationPath?: string; // URL/route to navigate to
  pageContext?: string; // Page component containing this feature
  prerequisites?: string[]; // Auth, data setup requirements
  relatedTests?: string[]; // Existing tests that may be impacted
  userFlow?: string; // Description of the E2E user journey
}

export interface ProposeTestOutput {
  success: boolean;
  id: string;
  message: string;
}

export interface ExecuteTestInput {
  sourceFile: string;
  targetTestPath: string;
  description: string;
  isUpdate: boolean;
}

export interface ExecuteTestOutput {
  success: boolean;
  testFilePath?: string;
  testContent?: string;
  error?: string;
}
