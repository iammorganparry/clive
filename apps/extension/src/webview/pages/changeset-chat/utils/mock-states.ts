import type { LanguageModelUsage } from "ai";
import type { ChatMessage } from "../../../types/chat.js";
import type {
  ChangesetChatError,
  TestSuiteQueueItem,
} from "../machines/changeset-chat-machine.js";
import type { TestFileExecution } from "./parse-test-output.js";

/**
 * Mock data factories for dev testing toolbar
 * These functions create realistic test data to simulate different UI states
 */

/**
 * Create mock plan content in the format expected by parsePlan
 */
export function createMockPlan(): string {
  return `name: Test Plan for Authentication Module
overview: Comprehensive test coverage for authentication logic including login, logout, and session management

## Implementation Plan

### 1. Unit Tests for Authentication Logic
**File**: [\`src/auth/__tests__/auth.test.ts\`](src/auth/__tests__/auth.test.ts)
**Issue**: Need to verify login credentials validation
**Solution**: Create unit tests for validateCredentials function
**Test Type**: unit

Lines to cover:
- validateCredentials function (lines 45-78)
- handleLogin function (lines 120-145)
- Session token generation (lines 200-225)

### 2. Integration Tests for Login Flow
**File**: [\`src/auth/__tests__/login.integration.test.ts\`](src/auth/__tests__/login.integration.test.ts)
**Issue**: Verify end-to-end login flow works correctly
**Solution**: Test login flow with database interactions
**Test Type**: integration

Lines to cover:
- Login endpoint handler (lines 50-100)
- Database session storage (lines 150-180)
- Cookie management (lines 200-230)

### 3. E2E Tests for User Authentication
**File**: [\`e2e/auth.spec.ts\`](e2e/auth.spec.ts)
**Issue**: Verify complete user authentication journey
**Solution**: Create Playwright tests for login/logout flows
**Test Type**: e2e

Lines to cover:
- Login page interaction (lines 1-50)
- Protected route access (lines 100-150)
- Logout functionality (lines 200-250)
`;
}

/**
 * Create mock test suite queue with pending items
 */
export function createMockTestSuiteQueue(): TestSuiteQueueItem[] {
  return [
    {
      id: "suite-1",
      name: "Unit Tests for Authentication Logic",
      testType: "unit",
      targetFilePath: "src/auth/__tests__/auth.test.ts",
      sourceFiles: ["src/auth/auth.ts"],
      status: "pending",
      description: "Create unit tests for validateCredentials function",
    },
    {
      id: "suite-2",
      name: "Integration Tests for Login Flow",
      testType: "integration",
      targetFilePath: "src/auth/__tests__/login.integration.test.ts",
      sourceFiles: ["src/auth/login.ts"],
      status: "pending",
      description: "Test login flow with database interactions",
    },
    {
      id: "suite-3",
      name: "E2E Tests for User Authentication",
      testType: "e2e",
      targetFilePath: "e2e/auth.spec.ts",
      sourceFiles: ["src/auth/auth.ts", "src/auth/login.ts"],
      status: "pending",
      description: "Create Playwright tests for login/logout flows",
    },
  ];
}

/**
 * Create mock test suite queue with active (in-progress) item
 */
export function createMockActiveQueue(): TestSuiteQueueItem[] {
  return [
    {
      id: "suite-1",
      name: "Unit Tests for Authentication Logic",
      testType: "unit",
      targetFilePath: "src/auth/__tests__/auth.test.ts",
      sourceFiles: ["src/auth/auth.ts"],
      status: "in_progress",
      description: "Create unit tests for validateCredentials function",
    },
    {
      id: "suite-2",
      name: "Integration Tests for Login Flow",
      testType: "integration",
      targetFilePath: "src/auth/__tests__/login.integration.test.ts",
      sourceFiles: ["src/auth/login.ts"],
      status: "pending",
      description: "Test login flow with database interactions",
    },
    {
      id: "suite-3",
      name: "E2E Tests for User Authentication",
      testType: "e2e",
      targetFilePath: "e2e/auth.spec.ts",
      sourceFiles: ["src/auth/auth.ts", "src/auth/login.ts"],
      status: "pending",
      description: "Create Playwright tests for login/logout flows",
    },
  ];
}

/**
 * Create mock test results with all tests passing
 */
export function createMockPassedTestResults(): TestFileExecution {
  return {
    filePath: "src/auth/__tests__/auth.test.ts",
    status: "completed",
    tests: [
      {
        testName: "validateCredentials should accept valid credentials",
        status: "pass",
        duration: 12,
      },
      {
        testName: "validateCredentials should reject invalid username",
        status: "pass",
        duration: 8,
      },
      {
        testName: "validateCredentials should reject invalid password",
        status: "pass",
        duration: 9,
      },
      {
        testName: "handleLogin should create session on success",
        status: "pass",
        duration: 45,
      },
      {
        testName: "handleLogin should return error on failure",
        status: "pass",
        duration: 11,
      },
    ],
    startedAt: new Date(Date.now() - 5000),
    completedAt: new Date(),
    summary: {
      total: 5,
      passed: 5,
      failed: 0,
    },
  };
}

/**
 * Create mock test results with some tests failing
 */
export function createMockFailedTestResults(): TestFileExecution {
  return {
    filePath: "src/auth/__tests__/auth.test.ts",
    status: "failed",
    tests: [
      {
        testName: "validateCredentials should accept valid credentials",
        status: "pass",
        duration: 12,
      },
      {
        testName: "validateCredentials should reject invalid username",
        status: "fail",
        duration: 8,
        error: "Expected function to throw, but it didn't",
      },
      {
        testName: "validateCredentials should reject invalid password",
        status: "pass",
        duration: 9,
      },
      {
        testName: "handleLogin should create session on success",
        status: "fail",
        duration: 45,
        error: "Session was not created: Database connection timeout",
      },
      {
        testName: "handleLogin should return error on failure",
        status: "pass",
        duration: 11,
      },
    ],
    startedAt: new Date(Date.now() - 5000),
    completedAt: new Date(),
    summary: {
      total: 5,
      passed: 3,
      failed: 2,
    },
  };
}

/**
 * Create mock test suite queue with all suites completed and passing
 */
export function createMockPassedSuiteQueue(): TestSuiteQueueItem[] {
  const passedResults = createMockPassedTestResults();
  return [
    {
      id: "suite-1",
      name: "Unit Tests for Authentication Logic",
      testType: "unit",
      targetFilePath: "src/auth/__tests__/auth.test.ts",
      sourceFiles: ["src/auth/auth.ts"],
      status: "completed",
      description: "Create unit tests for validateCredentials function",
      testResults: passedResults,
    },
    {
      id: "suite-2",
      name: "Integration Tests for Login Flow",
      testType: "integration",
      targetFilePath: "src/auth/__tests__/login.integration.test.ts",
      sourceFiles: ["src/auth/login.ts"],
      status: "completed",
      description: "Test login flow with database interactions",
      testResults: {
        ...passedResults,
        filePath: "src/auth/__tests__/login.integration.test.ts",
        tests: passedResults.tests.slice(0, 3),
        summary: {
          total: 3,
          passed: 3,
          failed: 0,
        },
      },
    },
  ];
}

/**
 * Create mock test suite queue with some suites failed
 */
export function createMockFailedSuiteQueue(): TestSuiteQueueItem[] {
  const passedResults = createMockPassedTestResults();
  const failedResults = createMockFailedTestResults();
  return [
    {
      id: "suite-1",
      name: "Unit Tests for Authentication Logic",
      testType: "unit",
      targetFilePath: "src/auth/__tests__/auth.test.ts",
      sourceFiles: ["src/auth/auth.ts"],
      status: "completed",
      description: "Create unit tests for validateCredentials function",
      testResults: passedResults,
    },
    {
      id: "suite-2",
      name: "Integration Tests for Login Flow",
      testType: "integration",
      targetFilePath: "src/auth/__tests__/login.integration.test.ts",
      sourceFiles: ["src/auth/login.ts"],
      status: "failed",
      description: "Test login flow with database interactions",
      testResults: failedResults,
    },
  ];
}

/**
 * Create mock test suite queue with mixed states (pending, in_progress, completed)
 */
export function createMockMixedQueue(): TestSuiteQueueItem[] {
  const passedResults = createMockPassedTestResults();
  return [
    {
      id: "suite-1",
      name: "Unit Tests for Authentication Logic",
      testType: "unit",
      targetFilePath: "src/auth/__tests__/auth.test.ts",
      sourceFiles: ["src/auth/auth.ts"],
      status: "completed",
      description: "Create unit tests for validateCredentials function",
      testResults: passedResults,
    },
    {
      id: "suite-2",
      name: "Integration Tests for Login Flow",
      testType: "integration",
      targetFilePath: "src/auth/__tests__/login.integration.test.ts",
      sourceFiles: ["src/auth/login.ts"],
      status: "in_progress",
      description: "Test login flow with database interactions",
    },
    {
      id: "suite-3",
      name: "E2E Tests for User Authentication",
      testType: "e2e",
      targetFilePath: "e2e/auth.spec.ts",
      sourceFiles: ["src/auth/auth.ts", "src/auth/login.ts"],
      status: "pending",
      description: "Create Playwright tests for login/logout flows",
    },
  ];
}

/**
 * Create mock message with bashExecute tool call
 */
export function createMockBashExecuteMessage(): ChatMessage {
  return {
    id: `msg-bash-${Date.now()}`,
    role: "assistant",
    parts: [
      { type: "text", text: "Running test command..." },
      {
        type: "tool-bashExecute",
        toolName: "bashExecute",
        toolCallId: `tool-bash-${Date.now()}`,
        state: "output-available",
        input: { command: "npm test -- auth.test.ts" },
        output: {
          stdout:
            "PASS src/auth/__tests__/auth.test.ts\n  ✓ validates credentials (12ms)\n  ✓ handles login (45ms)\n\nTests: 2 passed, 2 total",
          stderr: "",
          exitCode: 0,
          command: "npm test -- auth.test.ts",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with writeTestFile tool call
 */
export function createMockWriteTestFileMessage(): ChatMessage {
  return {
    id: `msg-write-${Date.now()}`,
    role: "assistant",
    parts: [
      { type: "text", text: "Writing test file..." },
      {
        type: "tool-writeTestFile",
        toolName: "writeTestFile",
        toolCallId: `tool-write-${Date.now()}`,
        state: "output-available",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          content:
            "import { validateCredentials } from '../auth';\n\ndescribe('Authentication', () => {\n  it('should validate credentials', () => {\n    expect(validateCredentials('user', 'pass')).toBe(true);\n  });\n});",
        },
        output: {
          success: true,
          filePath: "src/auth/__tests__/auth.test.ts",
          message: "Test file created successfully",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with writeTestFile awaiting approval
 */
export function createMockWriteTestFilePendingApproval(): ChatMessage {
  return {
    id: `msg-write-pending-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "I've prepared a test file for your review. Please approve or reject the changes in the diff view.",
      },
      {
        type: "tool-writeTestFile",
        toolName: "writeTestFile",
        toolCallId: `tool-write-pending-${Date.now()}`,
        state: "approval-requested",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          content:
            "import { validateCredentials } from '../auth';\n\ndescribe('Authentication', () => {\n  it('should validate credentials', () => {\n    expect(validateCredentials('user', 'pass')).toBe(true);\n  });\n});",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with writeTestFile rejected by user
 */
export function createMockWriteTestFileRejected(): ChatMessage {
  return {
    id: `msg-write-rejected-${Date.now()}`,
    role: "assistant",
    parts: [
      { type: "text", text: "I've prepared a test file for your review." },
      {
        type: "tool-writeTestFile",
        toolName: "writeTestFile",
        toolCallId: `tool-write-rejected-${Date.now()}`,
        state: "output-denied",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          content:
            "import { validateCredentials } from '../auth';\n\ndescribe('Authentication', () => {\n  it('should validate credentials', () => {\n    expect(validateCredentials('user', 'pass')).toBe(true);\n  });\n});",
        },
        output: {
          success: false,
          filePath: "src/auth/__tests__/auth.test.ts",
          message:
            "Changes to src/auth/__tests__/auth.test.ts were rejected by user.",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with searchKnowledge tool call
 */
export function createMockSearchKnowledgeMessage(): ChatMessage {
  return {
    id: `msg-search-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Searching knowledge base for authentication patterns...",
      },
      {
        type: "tool-searchKnowledge",
        toolName: "searchKnowledge",
        toolCallId: `tool-search-${Date.now()}`,
        state: "output-available",
        input: { query: "authentication testing patterns" },
        output: {
          results: [
            {
              category: "testing",
              title: "Authentication Testing Best Practices",
              content:
                "Use jest.mock() to mock authentication providers. Test both success and failure cases. Verify token generation and validation.",
              path: ".clive/knowledge/testing/auth-patterns.md",
            },
            {
              category: "security",
              title: "Security Testing Guidelines",
              content:
                "Always test edge cases like empty passwords, SQL injection attempts, and session timeout handling.",
              path: ".clive/knowledge/security/testing.md",
            },
          ],
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with editFileContent tool call
 */
export function createMockReplaceInFileMessage(): ChatMessage {
  return {
    id: `msg-replace-${Date.now()}`,
    role: "assistant",
    parts: [
      { type: "text", text: "Updating test file with improved assertions..." },
      {
        type: "tool-editFileContent",
        toolName: "editFileContent",
        toolCallId: `tool-replace-${Date.now()}`,
        state: "output-available",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          oldText: "expect(result).toBe(true);",
          newText:
            "expect(result).toEqual({ success: true, token: expect.any(String) });",
        },
        output: {
          success: true,
          filePath: "src/auth/__tests__/auth.test.ts",
          message: "Successfully replaced 1 occurrence",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with editFileContent awaiting approval
 */
export function createMockReplaceInFilePendingApproval(): ChatMessage {
  return {
    id: `msg-replace-pending-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "I've prepared changes to improve the test assertions. Please review and approve or reject.",
      },
      {
        type: "tool-editFileContent",
        toolName: "editFileContent",
        toolCallId: `tool-replace-pending-${Date.now()}`,
        state: "approval-requested",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          oldText: "expect(result).toBe(true);",
          newText:
            "expect(result).toEqual({ success: true, token: expect.any(String) });",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with editFileContent rejected by user
 */
export function createMockReplaceInFileRejected(): ChatMessage {
  return {
    id: `msg-replace-rejected-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "I've prepared changes to improve the test assertions.",
      },
      {
        type: "tool-editFileContent",
        toolName: "editFileContent",
        toolCallId: `tool-replace-rejected-${Date.now()}`,
        state: "output-denied",
        input: {
          filePath: "src/auth/__tests__/auth.test.ts",
          oldText: "expect(result).toBe(true);",
          newText:
            "expect(result).toEqual({ success: true, token: expect.any(String) });",
        },
        output: {
          success: false,
          filePath: "src/auth/__tests__/auth.test.ts",
          message:
            "Changes to src/auth/__tests__/auth.test.ts were rejected by user.",
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock message with webSearch tool call
 */
export function createMockWebSearchMessage(): ChatMessage {
  return {
    id: `msg-web-${Date.now()}`,
    role: "assistant",
    parts: [
      {
        type: "text",
        text: "Searching web for Jest authentication testing examples...",
      },
      {
        type: "tool-webSearch",
        toolName: "webSearch",
        toolCallId: `tool-web-${Date.now()}`,
        state: "output-available",
        input: { query: "jest authentication testing best practices" },
        output: {
          results: [
            {
              title: "Testing Authentication in Jest - Complete Guide",
              url: "https://jestjs.io/docs/auth-testing",
              snippet:
                "Learn how to test authentication flows in Jest with mocking strategies and best practices for secure testing.",
            },
            {
              title: "Mock Authentication for Testing | Jest Documentation",
              url: "https://jestjs.io/docs/mock-functions",
              snippet:
                "Use jest.mock() to simulate authentication providers and test various scenarios without real credentials.",
            },
          ],
        },
      },
    ],
    timestamp: new Date(),
  };
}

/**
 * Create mock reasoning state
 */
export function createMockReasoningState(): {
  reasoningContent: string;
  isReasoningStreaming: boolean;
} {
  return {
    reasoningContent: `Let me analyze the authentication module to identify test coverage gaps...

I notice the following areas that need testing:
1. Password validation logic - needs edge case tests
2. Session token generation - needs security tests
3. Login rate limiting - needs integration tests
4. Error handling for invalid credentials - needs unit tests

I'll propose a comprehensive test plan covering all these areas.`,
    isReasoningStreaming: false,
  };
}

/**
 * Create mock usage data
 */
export function createMockUsage(): LanguageModelUsage {
  return {
    inputTokens: 12543,
    outputTokens: 8921,
    totalTokens: 21464,
    reasoningTokens: 2156,
    cachedInputTokens: 8234,
    inputTokenDetails: {
      noCacheTokens: 4309,
      cacheReadTokens: 8234,
      cacheWriteTokens: 0,
    },
    outputTokenDetails: {
      textTokens: 6765,
      reasoningTokens: 2156,
    },
  };
}

/**
 * Create mock error
 */
export function createMockError(
  type: "subscription" | "analysis",
): ChangesetChatError {
  if (type === "subscription") {
    return {
      type: "SUBSCRIPTION_FAILED",
      message:
        "Failed to connect to AI service. Please check your network connection and try again.",
      retryable: true,
    };
  }
  return {
    type: "ANALYSIS_FAILED",
    message:
      "Analysis failed due to context length exceeded. Try analyzing fewer files at once.",
    retryable: true,
  };
}
