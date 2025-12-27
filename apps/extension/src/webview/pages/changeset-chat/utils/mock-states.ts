import type { TestSuiteQueueItem } from "../machines/changeset-chat-machine.js";
import type { TestFileExecution, } from "./parse-test-output.js";

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

