/**
 * Shared types for the AI agent tools and responses
 */

// Test type enum
export type TestType = "unit" | "integration" | "e2e";

// Framework detection
export interface DetectedFramework {
  name: string; // "vitest", "jest", "playwright", "cypress", etc.
  version?: string;
  configPath?: string;
  testType: TestType;
}

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
  proposalId: string;
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

export interface TestCase {
  name: string; // e.g., "should login with valid credentials"
  testType: TestType; // NEW: Which type of test
  framework?: string; // NEW: Which framework to use
  userActions: string[]; // Step-by-step actions
  assertions: string[]; // Expected outcomes to verify
  category: "happy_path" | "error" | "edge_case" | "accessibility";
  // Unit/integration specific
  mockDependencies?: string[]; // Dependencies to mock
  testSetup?: string[]; // Setup steps
}

export interface ProposedTest {
  id: string;
  sourceFile: string;
  targetTestPath: string; // Not used in multi-strategy approach
  description: string;
  isUpdate: boolean;
  testType: TestType; // Default for backward compatibility
  framework: string; // Default for backward compatibility
  testStrategies?: TestStrategy[]; // NEW: Multiple test strategies
  proposedContent: string; // The actual test code that will be written
  existingContent?: string; // Current file content (for updates)
  // E2E-specific fields (for backward compatibility)
  navigationPath?: string; // URL/route to navigate to
  pageContext?: string; // Page component containing this feature
  prerequisites?: string[]; // Auth, data setup requirements
  relatedTests?: string[]; // Existing tests that may be impacted
  userFlow?: string; // Description of the E2E user journey
  testCases?: TestCase[]; // Structured test scenarios with actions and assertions
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

export interface TestStrategy {
  testType: TestType;
  framework: string;
  targetTestPath: string;
  description: string;
  isUpdate: boolean;
  // E2E-specific fields
  navigationPath?: string;
  pageContext?: string;
  prerequisites?: string[];
  userFlow?: string;
  // Unit/Integration specific
  mockDependencies?: string[];
  testSetup?: string[];
  testCases: TestCase[];
}

export interface ProposeTestInput {
  sourceFile: string;
  testStrategies: TestStrategy[]; // NEW: Multiple test strategies in one proposal
  relatedTests?: string[]; // Existing tests that may be impacted
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
  testType: TestType; // NEW: Which type of test to execute
  framework: string; // NEW: Which framework to use
}

export interface ExecuteTestOutput {
  success: boolean;
  testFilePath?: string;
  testContent?: string;
  error?: string;
}

export interface BashExecuteInput {
  command: string;
}

export interface BashExecuteOutput {
  stdout: string;
  stderr?: string;
  exitCode: number | null;
  wasTruncated?: boolean;
  command: string;
  /** Set to true when the command was cancelled by the user */
  cancelled?: boolean;
  /** Human-readable message about the result */
  message?: string;
}

export interface RunTestInput {
  testType: "unit" | "integration" | "e2e";
  command: string;
  testFile?: string;
  reason: string;
}

export interface RunTestOutput {
  status: "pending_approval" | "completed" | "failed";
  approvalId?: string;
  testType: string;
  command: string;
  reason?: string;
  output?: string;
  exitCode?: number;
  passed?: boolean;
  message?: string;
}
