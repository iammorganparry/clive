import { describe, it, expect } from "vitest";
import {
  isTestCommand,
  extractTestFilePath,
  parseTestOutput,
  updateTestExecution,
} from "./parse-test-output.js";

describe("parse-test-output", () => {
  describe("isTestCommand", () => {
    it("detects vitest commands", () => {
      expect(isTestCommand("vitest run")).toBe(true);
      expect(isTestCommand("vitest test")).toBe(true);
      expect(isTestCommand("npx vitest run")).toBe(true);
    });

    it("detects jest commands", () => {
      expect(isTestCommand("jest test")).toBe(true);
      expect(isTestCommand("jest run")).toBe(true);
      expect(isTestCommand("npx jest test")).toBe(true);
    });

    it("detects playwright commands", () => {
      expect(isTestCommand("playwright test")).toBe(true);
      expect(isTestCommand("npx playwright test")).toBe(true);
    });

    it("detects pytest commands", () => {
      expect(isTestCommand("pytest")).toBe(true);
      expect(isTestCommand("pytest tests/")).toBe(true);
    });

    it("detects python unittest commands", () => {
      expect(isTestCommand("python -m unittest")).toBe(true);
    });

    it("detects go test commands", () => {
      expect(isTestCommand("go test")).toBe(true);
      expect(isTestCommand("go test ./...")).toBe(true);
    });

    it("detects cargo test commands", () => {
      expect(isTestCommand("cargo test")).toBe(true);
    });

    it("detects rspec commands", () => {
      expect(isTestCommand("rspec")).toBe(true);
      expect(isTestCommand("bundle exec rspec")).toBe(true);
    });

    it("detects maven test commands", () => {
      expect(isTestCommand("mvn test")).toBe(true);
    });

    it("detects dotnet test commands", () => {
      expect(isTestCommand("dotnet test")).toBe(true);
    });

    it("detects phpunit commands", () => {
      expect(isTestCommand("phpunit")).toBe(true);
      expect(isTestCommand("vendor/bin/phpunit")).toBe(true);
    });

    it("detects npm/yarn/pnpm test commands", () => {
      expect(isTestCommand("npm test")).toBe(true);
      expect(isTestCommand("npm run test")).toBe(true);
      expect(isTestCommand("yarn test")).toBe(true);
      expect(isTestCommand("pnpm test")).toBe(true);
    });

    it("returns false for non-test commands", () => {
      expect(isTestCommand("npm install")).toBe(false);
      expect(isTestCommand("git commit")).toBe(false);
      expect(isTestCommand("ls -la")).toBe(false);
    });
  });

  describe("extractTestFilePath", () => {
    it("extracts JS test file paths", () => {
      expect(extractTestFilePath("vitest run src/test.spec.ts")).toBe(
        "src/test.spec.ts",
      );
      expect(extractTestFilePath("jest test utils.test.js")).toBe(
        "utils.test.js",
      );
      expect(extractTestFilePath("playwright test auth.spec.tsx")).toBe(
        "auth.spec.tsx",
      );
    });

    it("extracts Python test file paths", () => {
      expect(extractTestFilePath("pytest tests/test_auth.py")).toBe(
        "tests/test_auth.py",
      );
      expect(extractTestFilePath("python -m unittest auth_test.py")).toBe(
        "auth_test.py",
      );
    });

    it("extracts Go test file paths", () => {
      expect(extractTestFilePath("go test auth_test.go")).toBe("auth_test.go");
    });

    it("extracts Rust test file paths", () => {
      expect(extractTestFilePath("cargo test tests/integration.rs")).toBe(
        "tests/integration.rs",
      );
    });

    it("extracts Ruby test file paths", () => {
      expect(extractTestFilePath("rspec spec/user_spec.rb")).toBe(
        "spec/user_spec.rb",
      );
    });

    it("extracts Java test file paths", () => {
      expect(extractTestFilePath("mvn test -Dtest=UserTest.java")).toBe(
        "UserTest.java",
      );
    });

    it("extracts C# test file paths", () => {
      expect(extractTestFilePath("dotnet test UserTests.cs")).toBe(
        "UserTests.cs",
      );
    });

    it("extracts PHP test file paths", () => {
      expect(extractTestFilePath("phpunit UserTest.php")).toBe("UserTest.php");
    });

    it("returns null for commands without file paths", () => {
      expect(extractTestFilePath("npm test")).toBeNull();
      expect(extractTestFilePath("go test ./...")).toBeNull();
    });
  });

  describe("parseVitestJestOutput", () => {
    it("parses passing tests with durations", () => {
      const output = `
 ✓ test valid credentials (123ms)
 ✓ test invalid password (45ms)
      `.trim();

      const results = parseTestOutput(output, "vitest run");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "test valid credentials",
        status: "pass",
        duration: 123,
      });
      expect(results[1]).toMatchObject({
        testName: "test invalid password",
        status: "pass",
        duration: 45,
      });
    });

    it("parses failing tests with error messages", () => {
      const output = `
 ✗ test invalid password (45ms)
   Error: Expected true but got false
      `.trim();

      const results = parseTestOutput(output, "vitest run");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        testName: "test invalid password",
        status: "fail",
        duration: 45,
      });
      expect(results[0].error).toBeTruthy();
    });

    it("handles nested describe blocks", () => {
      const output = `
 ✓ UserAuth > login > valid credentials (100ms)
 ✗ UserAuth > login > invalid password (50ms)
      `.trim();

      const results = parseTestOutput(output, "vitest run");
      expect(results).toHaveLength(2);
      expect(results[0].testName).toContain("UserAuth");
    });
  });

  describe("parsePlaywrightOutput", () => {
    it("parses playwright test output", () => {
      const output = `
ok 1 - login with valid credentials
failed 2 - login with invalid password
ok 3 - logout
      `.trim();

      const results = parseTestOutput(output, "playwright test");
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        testName: "login with valid credentials",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "login with invalid password",
        status: "fail",
      });
      expect(results[2]).toMatchObject({
        testName: "logout",
        status: "pass",
      });
    });
  });

  describe("parsePytestOutput", () => {
    it("parses pytest verbose output", () => {
      const output = `
tests/test_auth.py::TestLogin::test_valid_credentials PASSED [10%]
tests/test_auth.py::TestLogin::test_invalid_password FAILED [20%]
      `.trim();

      const results = parseTestOutput(output, "pytest");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "test_valid_credentials",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "test_invalid_password",
        status: "fail",
      });
    });

    it("handles parametrized tests", () => {
      const output = `
tests/test_auth.py::TestLogin::test_login[user1] PASSED
tests/test_auth.py::TestLogin::test_login[user2] FAILED
      `.trim();

      const results = parseTestOutput(output, "pytest");
      expect(results).toHaveLength(2);
      expect(results[0].testName).toContain("test_login");
    });

    it("extracts stack traces", () => {
      const output = `
tests/test_auth.py::TestLogin::test_invalid_password FAILED
AssertionError: Expected True but got False
  File "test_auth.py", line 42, in test_invalid_password
    assert result == True
      `.trim();

      const results = parseTestOutput(output, "pytest");
      expect(results[0].error).toContain("AssertionError");
    });
  });

  describe("parseUnittestOutput", () => {
    it("parses unittest dot notation", () => {
      const output = `
test_valid_credentials (__main__.TestLogin) ... ok
test_invalid_password (__main__.TestLogin) ... FAIL
      `.trim();

      const results = parseTestOutput(output, "python -m unittest");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "test_valid_credentials",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "test_invalid_password",
        status: "fail",
      });
    });

    it("parses unittest dot summary", () => {
      const output = `
...
FAIL
      `.trim();

      const results = parseTestOutput(output, "python -m unittest");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("parseGoTestOutput", () => {
    it("parses go test output", () => {
      const output = `
=== RUN   TestAdd
--- PASS: TestAdd (0.00s)
=== RUN   TestSubtract
--- FAIL: TestSubtract (0.01s)
      `.trim();

      const results = parseTestOutput(output, "go test");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "TestAdd",
        status: "pass",
        duration: 0,
      });
      expect(results[1]).toMatchObject({
        testName: "TestSubtract",
        status: "fail",
        duration: 10,
      });
    });

    it("handles subtests", () => {
      const output = `
--- PASS: TestAdd/subtest_name (0.00s)
--- FAIL: TestAdd/another_subtest (0.01s)
      `.trim();

      const results = parseTestOutput(output, "go test");
      expect(results).toHaveLength(2);
      expect(results[0].testName).toContain("/");
    });
  });

  describe("parseCargoTestOutput", () => {
    it("parses cargo test output", () => {
      const output = `
running 3 tests
test tests::it_works ... ok
test tests::failing_test ... FAILED
test tests::another_test ... ok
      `.trim();

      const results = parseTestOutput(output, "cargo test");
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        testName: "tests::it_works",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "tests::failing_test",
        status: "fail",
      });
    });
  });

  describe("parseRSpecOutput", () => {
    it("parses RSpec output", () => {
      const output = `
UserAuth
  #login
    ✓ accepts valid credentials (0.05s)
    ✗ rejects invalid password (0.03s)
      `.trim();

      const results = parseTestOutput(output, "rspec");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "accepts valid credentials",
        status: "pass",
        duration: 50,
      });
      expect(results[1]).toMatchObject({
        testName: "rejects invalid password",
        status: "fail",
        duration: 30,
      });
    });
  });

  describe("parseMinitestOutput", () => {
    it("parses Minitest output", () => {
      const output = `
test_valid_credentials#TestLogin = 0.05 s = .
test_invalid_password#TestLogin = 0.03 s = F
      `.trim();

      const results = parseTestOutput(output, "ruby test");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("parseJUnitOutput", () => {
    it("parses JUnit console output", () => {
      const output = `
testValidCredentials(com.example.TestLogin) ... SUCCESS
testInvalidPassword(com.example.TestLogin) ... FAILURE
      `.trim();

      const results = parseTestOutput(output, "mvn test");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "testValidCredentials",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "testInvalidPassword",
        status: "fail",
      });
    });
  });

  describe("parseDotNetTestOutput", () => {
    it("parses dotnet test output", () => {
      const output = `
✓ TestLogin.testValidCredentials [100ms]
✗ TestLogin.testInvalidPassword [50ms]
      `.trim();

      const results = parseTestOutput(output, "dotnet test");
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        testName: "TestLogin.testValidCredentials",
        status: "pass",
        duration: 100,
      });
      expect(results[1]).toMatchObject({
        testName: "TestLogin.testInvalidPassword",
        status: "fail",
        duration: 50,
      });
    });
  });

  describe("parsePHPUnitOutput", () => {
    it("parses PHPUnit dot notation", () => {
      const output = `
..F..
      `.trim();

      const results = parseTestOutput(output, "phpunit");
      expect(results).toHaveLength(5);
      expect(results[0].status).toBe("pass");
      expect(results[2].status).toBe("fail");
    });
  });

  describe("parseTAPOutput", () => {
    it("parses TAP format", () => {
      const output = `
1..5
ok 1 - Input validation
not ok 2 - Database connection
ok 3 - API response
      `.trim();

      const results = parseTestOutput(output, "test");
      expect(results).toHaveLength(3);
      expect(results[0]).toMatchObject({
        testName: "Input validation",
        status: "pass",
      });
      expect(results[1]).toMatchObject({
        testName: "Database connection",
        status: "fail",
      });
    });
  });

  describe("parseTestOutput", () => {
    it("auto-detects vitest output", () => {
      const output = "✓ test name (123ms)";
      const results = parseTestOutput(output, "vitest run");
      expect(results.length).toBeGreaterThan(0);
    });

    it("auto-detects pytest output", () => {
      const output = "tests/test.py::test_name PASSED";
      const results = parseTestOutput(output, "pytest");
      expect(results.length).toBeGreaterThan(0);
    });

    it("auto-detects go test output", () => {
      const output = "--- PASS: TestName (0.00s)";
      const results = parseTestOutput(output, "go test");
      expect(results.length).toBeGreaterThan(0);
    });

    it("falls back to generic parser", () => {
      const output = "test_name: PASS";
      const results = parseTestOutput(output, "unknown test");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles string output", () => {
      const output = "✓ test (100ms)";
      const results = parseTestOutput(output, "vitest");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles object output with stdout", () => {
      const output = { stdout: "✓ test (100ms)" };
      const results = parseTestOutput(output, "vitest");
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty array for invalid output", () => {
      expect(parseTestOutput(null, "test")).toEqual([]);
      expect(parseTestOutput({}, "test")).toEqual([]);
      expect(parseTestOutput("", "test")).toEqual([]);
    });
  });

  describe("updateTestExecution", () => {
    it("creates new execution on first test", () => {
      const output = "✓ test1 (100ms)\n✓ test2 (200ms)";
      const execution = updateTestExecution(
        null,
        "vitest run test.spec.ts",
        output,
      );

      expect(execution).not.toBeNull();
      expect(execution?.filePath).toBeTruthy();
      expect(execution?.tests).toHaveLength(2);
      expect(execution?.startedAt).toBeInstanceOf(Date);
    });

    it("updates existing execution with new results", () => {
      const initialOutput = "✓ test1 (100ms)";
      const initial = updateTestExecution(
        null,
        "vitest run test.spec.ts",
        initialOutput,
      );

      const updatedOutput = "✓ test1 (100ms)\n✓ test2 (200ms)";
      const updated = updateTestExecution(
        initial,
        "vitest run test.spec.ts",
        updatedOutput,
      );

      expect(updated?.tests).toHaveLength(2);
      expect(updated?.summary?.total).toBe(2);
    });

    it("handles switching between test files", () => {
      const firstOutput = "✓ test1 (100ms)";
      const first = updateTestExecution(
        null,
        "vitest run test1.spec.ts",
        firstOutput,
      );

      const secondOutput = "✓ test2 (200ms)";
      const second = updateTestExecution(
        first,
        "vitest run test2.spec.ts",
        secondOutput,
      );

      expect(second?.filePath).toContain("test2");
      expect(second?.tests.length).toBeGreaterThan(0);
    });

    it("tracks test status transitions", () => {
      const runningOutput = "running test...";
      const running = updateTestExecution(
        null,
        "vitest run test.spec.ts",
        runningOutput,
      );

      const completedOutput = "✓ test1 (100ms)\n✓ test2 (200ms)";
      const completed = updateTestExecution(
        running,
        "vitest run test.spec.ts",
        completedOutput,
      );

      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeInstanceOf(Date);
    });

    it("detects failures correctly", () => {
      const output = "✓ test1 (100ms)\n✗ test2 (200ms)";
      const execution = updateTestExecution(
        null,
        "vitest run test.spec.ts",
        output,
      );

      expect(execution?.status).toBe("failed");
      expect(execution?.summary?.failed).toBeGreaterThan(0);
    });

    it("calculates summary statistics", () => {
      const output = "✓ test1\n✓ test2\n✗ test3";
      const execution = updateTestExecution(
        null,
        "vitest run test.spec.ts",
        output,
      );

      expect(execution?.summary?.total).toBe(3);
      expect(execution?.summary?.passed).toBe(2);
      expect(execution?.summary?.failed).toBe(1);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty output", () => {
      const results = parseTestOutput("", "vitest");
      expect(results).toEqual([]);
    });

    it("handles partial output (streaming scenarios)", () => {
      const partialOutput = "✓ test1";
      const results = parseTestOutput(partialOutput, "vitest");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles tests with special characters in names", () => {
      const output = "✓ test with 'quotes' and \"double quotes\" (100ms)";
      const results = parseTestOutput(output, "vitest");
      expect(results.length).toBeGreaterThan(0);
    });

    it("handles very long test names", () => {
      const longName = "a".repeat(200);
      const output = `✓ ${longName} (100ms)`;
      const results = parseTestOutput(output, "vitest");
      expect(results[0].testName.length).toBeGreaterThan(100);
    });

    it("handles mixed pass/fail tests", () => {
      const output = "✓ test1\n✗ test2\n✓ test3";
      const results = parseTestOutput(output, "vitest");
      expect(results.filter((r) => r.status === "pass")).toHaveLength(2);
      expect(results.filter((r) => r.status === "fail")).toHaveLength(1);
    });

    it("handles duration in seconds", () => {
      const output = "✓ test (1.5s)";
      const results = parseTestOutput(output, "vitest");
      expect(results[0].duration).toBe(1500);
    });

    it("handles duration in milliseconds", () => {
      const output = "✓ test (1500ms)";
      const results = parseTestOutput(output, "vitest");
      expect(results[0].duration).toBe(1500);
    });
  });
});
