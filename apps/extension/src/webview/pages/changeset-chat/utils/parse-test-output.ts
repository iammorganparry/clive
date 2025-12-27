/**
 * Utility to parse test output from various test frameworks
 * Supports multiple languages: JavaScript/TypeScript, Python, Go, Rust, Ruby, Java, C#, PHP, and TAP format
 */

export type TestStatus = "running" | "pass" | "fail";

export interface TestResult {
  testName: string;
  status: TestStatus;
  duration?: number; // in milliseconds
  error?: string;
}

export interface TestFileExecution {
  filePath: string;
  status: "running" | "completed" | "failed";
  tests: TestResult[];
  startedAt: Date;
  completedAt?: Date;
  summary?: {
    total: number;
    passed: number;
    failed: number;
  };
}

/**
 * Framework parser interface
 */
interface TestFrameworkParser {
  name: string;
  detect: (output: string, command: string) => boolean;
  parse: (output: string) => TestResult[];
  extractFilePath?: (command: string) => string | null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract error message from output lines
 */
function extractError(lines: string[], startIndex: number): string {
  const errorLines: string[] = [];
  let inError = false;
  let braceCount = 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes("Error:") ||
      line.includes("FAILED") ||
      line.includes("AssertionError")
    ) {
      inError = true;
    }
    if (inError) {
      errorLines.push(line);
      braceCount +=
        (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (braceCount <= 0 && line.trim() && i > startIndex + 2) {
        break;
      }
    }
  }

  return errorLines.join("\n").trim();
}

/**
 * Parse duration from various formats
 */
function parseDuration(text: string): number | undefined {
  // Match: (123ms), (1.23s), (0.05s), etc.
  const msMatch = text.match(/\((\d+(?:\.\d+)?)\s*ms\)/);
  if (msMatch) {
    return Math.round(parseFloat(msMatch[1]));
  }

  const sMatch = text.match(/\((\d+(?:\.\d+)?)\s*s\)/);
  if (sMatch) {
    return Math.round(parseFloat(sMatch[1]) * 1000);
  }

  return undefined;
}

// ============================================================================
// JavaScript/TypeScript Parsers
// ============================================================================

function parseVitestJestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const checkmarkMatch = line.match(/^[\s]*[✓✔]/);
    const crossMatch = line.match(/^[\s]*[✗✘×]/);

    if (checkmarkMatch || crossMatch) {
      // Match test name and optional duration: ✓ test name (123ms)
      // First try to match with duration
      const withDurationMatch = line.match(
        /[✓✔✗✘×]\s+(.+?)\s+\((\d+(?:\.\d+)?)\s*(ms|s)\)/,
      );
      if (withDurationMatch) {
        const testName = withDurationMatch[1].trim();
        const durationValue = parseFloat(withDurationMatch[2]);
        const durationUnit = withDurationMatch[3];
        const duration =
          durationUnit === "s"
            ? Math.round(durationValue * 1000)
            : Math.round(durationValue);
        const status: TestStatus = checkmarkMatch ? "pass" : "fail";
        const error = status === "fail" ? extractError(lines, i) : undefined;

        results.push({
          testName,
          status,
          duration,
          error,
        });
      } else {
        // Match without duration - everything after checkmark to end of line
        const withoutDurationMatch = line.match(/[✓✔✗✘×]\s+(.+)$/);
        if (withoutDurationMatch) {
          const testName = withoutDurationMatch[1].trim();
          const status: TestStatus = checkmarkMatch ? "pass" : "fail";
          const error = status === "fail" ? extractError(lines, i) : undefined;

          results.push({
            testName,
            status,
            error,
          });
        }
      }
    }

    // Match: PASS or FAIL indicators
    if (line.includes("PASS") && !line.includes("FAIL")) {
      const testNameMatch = line.match(/PASS\s+(.+)/);
      if (testNameMatch) {
        results.push({
          testName: testNameMatch[1].trim(),
          status: "pass",
        });
      }
    }

    if (line.includes("FAIL")) {
      const testNameMatch = line.match(/FAIL\s+(.+)/);
      if (testNameMatch) {
        results.push({
          testName: testNameMatch[1].trim(),
          status: "fail",
          error: extractError(lines, i),
        });
      }
    }
  }

  return results;
}

function parsePlaywrightOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Match: ok 1 - test name or ok 1 test name
    const okMatch = line.match(/^ok\s+\d+\s+(?:-\s+)?(.+)$/);
    if (okMatch) {
      results.push({
        testName: okMatch[1].trim(),
        status: "pass",
        duration: parseDuration(line),
      });
      continue;
    }

    // Match: failed 2 - test name or failed 2 test name
    const failedMatch = line.match(/^failed\s+\d+\s+(?:-\s+)?(.+)$/);
    if (failedMatch) {
      results.push({
        testName: failedMatch[1].trim(),
        status: "fail",
        error: extractError(lines, i),
      });
    }
  }

  return results;
}

// ============================================================================
// Python Parsers
// ============================================================================

function parsePytestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: tests/test_auth.py::TestLogin::test_valid_credentials PASSED [10%]
    // Match: tests/test_auth.py::TestLogin::test_invalid_password FAILED [20%]
    const pytestMatch = line.match(
      /(.+?)\s+(PASSED|FAILED|ERROR|SKIPPED)(?:\s+\[.+?\])?(?:\s+\((.+?)\))?/,
    );
    if (pytestMatch) {
      const testPath = pytestMatch[1].trim();
      const statusStr = pytestMatch[2];
      const durationStr = pytestMatch[3];

      // Extract test name from path (last part after ::)
      const testName = testPath.includes("::")
        ? testPath.split("::").pop() || testPath
        : testPath;
      const status: TestStatus = statusStr === "PASSED" ? "pass" : "fail";
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;
      const error = status === "fail" ? extractError(lines, i) : undefined;

      results.push({
        testName,
        status,
        duration,
        error,
      });
    }
  }

  return results;
}

function parseUnittestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: test_valid_credentials (__main__.TestLogin) ... ok
    // Match: test_invalid_password (__main__.TestLogin) ... FAIL
    const unittestMatch = line.match(
      /(\w+)\s+\(.+?\)\s+\.\.\.\s+(ok|FAIL|ERROR|SKIP)/,
    );
    if (unittestMatch) {
      const testName = unittestMatch[1];
      const statusStr = unittestMatch[2];
      const status: TestStatus = statusStr === "ok" ? "pass" : "fail";
      const error = status === "fail" ? extractError(lines, i) : undefined;

      results.push({
        testName,
        status,
        error,
      });
    }

    // Match: . for passed, F for failed, E for error
    if (line.match(/^[.FEs]+$/)) {
      const dots = line.split("");
      dots.forEach((char, idx) => {
        if (char === ".") {
          results.push({
            testName: `test_${idx}`,
            status: "pass",
          });
        } else if (char === "F" || char === "E") {
          results.push({
            testName: `test_${idx}`,
            status: "fail",
          });
        }
      });
    }
  }

  return results;
}

// ============================================================================
// Go Parser
// ============================================================================

function parseGoTestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: --- PASS: TestAdd (0.00s)
    // Match: --- FAIL: TestSubtract (0.01s)
    // Match subtests: --- PASS: TestAdd/subtest_name (0.00s)
    const resultMatch = line.match(
      /---\s+(PASS|FAIL|SKIP):\s+(.+?)(?:\s+\((.+?)\))?$/,
    );
    if (resultMatch) {
      const statusStr = resultMatch[1];
      const testName = resultMatch[2].trim();
      const durationStr = resultMatch[3];

      const status: TestStatus = statusStr === "PASS" ? "pass" : "fail";
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;
      
      // Extract error message for failed tests
      let error: string | undefined ;
      if (status === "fail") {
        // Go test error messages appear on lines following the FAIL line
        // They typically start with whitespace and contain file:line: format
        const errorLines: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          // Stop if we hit another test result line
          if (nextLine.match(/---\s+(PASS|FAIL|SKIP):/)) {
            break;
          }
          // Collect error lines (typically indented with file:line: format)
          if (nextLine.trim()) {
            errorLines.push(nextLine.trim());
            // Stop after collecting a reasonable amount of error context
            // Usually Go test errors are 1-3 lines
            if (errorLines.length >= 5) {
              break;
            }
          } else if (errorLines.length > 0) {
            // Empty line after error lines means we're done
            break;
          }
        }
        error = errorLines.length > 0 ? errorLines.join("\n") : undefined;
      }

      results.push({
        testName,
        status,
        duration,
        error,
      });
    }
  }

  return results;
}

// ============================================================================
// Rust Parser
// ============================================================================

function parseCargoTestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip summary lines like "running 3 tests"
    if (/^running \d+ test/.test(line)) {
      continue;
    }

    // Match: test tests::it_works ... ok
    // Match: test tests::failing_test ... FAILED
    const cargoMatch = line.match(/^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED)$/);
    if (cargoMatch) {
      const testName = cargoMatch[1].trim();
      const statusStr = cargoMatch[2];
      const status: TestStatus = statusStr === "ok" ? "pass" : "fail";
      const error = status === "fail" ? extractError(lines, i) : undefined;

      results.push({
        testName,
        status,
        error,
      });
    }
  }

  return results;
}

// ============================================================================
// Ruby Parsers
// ============================================================================

function parseRSpecOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: ✓ accepts valid credentials (0.05s)
    // Match: ✗ rejects invalid password (0.03s)
    const checkmarkMatch = line.match(/[✓✔]\s+(.+?)(?:\s+\((.+?)\))?$/);
    if (checkmarkMatch) {
      const testName = checkmarkMatch[1].trim();
      const durationStr = checkmarkMatch[2];
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;

      results.push({
        testName,
        status: "pass",
        duration,
      });
      continue;
    }

    const crossMatch = line.match(/[✗✘×]\s+(.+?)(?:\s+\((.+?)\))?$/);
    if (crossMatch) {
      const testName = crossMatch[1].trim();
      const durationStr = crossMatch[2];
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;

      results.push({
        testName,
        status: "fail",
        error: extractError(lines, i),
        duration,
      });
      continue;
    }

    // Match: F for failed, P for pending
    if (line.match(/^[.FP]+$/)) {
      const chars = line.split("");
      chars.forEach((char, idx) => {
        if (char === ".") {
          results.push({
            testName: `test_${idx}`,
            status: "pass",
          });
        } else if (char === "F") {
          results.push({
            testName: `test_${idx}`,
            status: "fail",
          });
        }
      });
    }
  }

  return results;
}

function parseMinitestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: test_valid_credentials#TestLogin = 0.05 s = .
    // Match: test_invalid_password#TestLogin = 0.03 s = F
    const minitestMatch = line.match(
      /(\w+)#\w+\s+=\s+(.+?)\s+s\s+=\s+(\.|F|E|S)/,
    );
    if (minitestMatch) {
      const testName = minitestMatch[1];
      const durationStr = minitestMatch[2];
      const statusChar = minitestMatch[3];

      const status: TestStatus = statusChar === "." ? "pass" : "fail";
      const duration = durationStr
        ? parseDuration(`(${durationStr}s)`)
        : undefined;
      const error = status === "fail" ? extractError(lines, i) : undefined;

      results.push({
        testName,
        status,
        duration,
        error,
      });
    }
  }

  return results;
}

// ============================================================================
// Java Parsers
// ============================================================================

function parseJUnitOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: testValidCredentials(com.example.TestLogin) ... SUCCESS
    // Match: testInvalidPassword(com.example.TestLogin) ... FAILURE
    const junitMatch = line.match(
      /(\w+)\s*\(.+?\)\s+\.\.\.\s+(SUCCESS|FAILURE|ERROR)/,
    );
    if (junitMatch) {
      const testName = junitMatch[1];
      const statusStr = junitMatch[2];
      const status: TestStatus = statusStr === "SUCCESS" ? "pass" : "fail";
      const error = status === "fail" ? extractError(lines, i) : undefined;

      results.push({
        testName,
        status,
        error,
      });
    }

    // Match: [INFO] Tests run: 5, Failures: 1, Errors: 0, Skipped: 0
    // This is more of a summary, but we can extract individual test names from context
  }

  return results;
}

function parseTestNGOutput(output: string): TestResult[] {
  // TestNG output is similar to JUnit
  return parseJUnitOutput(output);
}

// ============================================================================
// C# Parsers
// ============================================================================

function parseDotNetTestOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match: ✓ TestLogin.testValidCredentials [100ms]
    // Match: ✗ TestLogin.testInvalidPassword [50ms]
    const checkmarkMatch = line.match(/^[✓✔]\s+(.+?)(?:\s+\[(.+?)\])?$/);
    if (checkmarkMatch) {
      const testName = checkmarkMatch[1].trim();
      const durationStr = checkmarkMatch[2];
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;

      results.push({
        testName,
        status: "pass",
        duration,
      });
      continue;
    }

    const crossMatch = line.match(/^[✗✘×]\s+(.+?)(?:\s+\[(.+?)\])?$/);
    if (crossMatch) {
      const testName = crossMatch[1].trim();
      const durationStr = crossMatch[2];
      const duration = durationStr
        ? parseDuration(`(${durationStr})`)
        : undefined;

      results.push({
        testName,
        status: "fail",
        error: extractError(lines, i),
        duration,
      });
    }

    // Match: Passed!  - Failed:     0, Passed:     5, Skipped:     0
    // This is a summary line
  }

  return results;
}

// ============================================================================
// PHP Parser
// ============================================================================

function parsePHPUnitOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: . for passed, F for failed, E for error
    if (line.match(/^[.FEsI]+$/)) {
      const chars = line.split("");
      chars.forEach((char, idx) => {
        if (char === ".") {
          results.push({
            testName: `test_${idx}`,
            status: "pass",
          });
        } else if (char === "F" || char === "E") {
          results.push({
            testName: `test_${idx}`,
            status: "fail",
          });
        }
      });
    }

    // Match: OK (5 tests, 10 assertions)
    // Match: FAILURES! Tests: 5, Assertions: 10, Failures: 1
    // These are summary lines
  }

  return results;
}

// ============================================================================
// TAP Parser
// ============================================================================

function parseTAPOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    // Skip TAP plan line (1..N)
    if (/^1\.\.\d+$/.test(trimmedLine)) {
      continue;
    }
    // Match: ok 1 - Input validation
    // Match: not ok 2 - Database connection
    // Also match without dash: ok 1 Input validation
    const tapMatch = trimmedLine.match(/^(ok|not ok)\s+\d+\s+(?:-\s+)?(.+)$/);
    if (tapMatch) {
      const statusStr = tapMatch[1];
      const testName = tapMatch[2].trim();
      const status: TestStatus = statusStr === "ok" ? "pass" : "fail";

      results.push({
        testName,
        status,
      });
    }

    // Match: # skip reason
    // Match: # todo reason
    // These are directives we can handle
  }

  return results;
}

// ============================================================================
// Generic Parser
// ============================================================================

function parseGenericOutput(output: string): TestResult[] {
  const results: TestResult[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Match: test_name: PASS or test_name: FAIL
    const passMatch = trimmedLine.match(/^(.+?):\s*PASS\s*$/i);
    if (passMatch) {
      results.push({
        testName: passMatch[1].trim(),
        status: "pass",
      });
      continue;
    }

    const failMatch = trimmedLine.match(/^(.+?):\s*FAIL\s*$/i);
    if (failMatch) {
      results.push({
        testName: failMatch[1].trim(),
        status: "fail",
      });
    }
  }

  return results;
}

// ============================================================================
// Framework Detectors
// ============================================================================

function detectPytest(output: string, command: string): boolean {
  return (
    /pytest/i.test(command) ||
    /\.py/.test(command) ||
    (/\.py::/.test(output) && /PASSED|FAILED|ERROR|SKIPPED/.test(output))
  );
}

function detectUnittest(output: string, command: string): boolean {
  return (
    /python.*-m\s+unittest/i.test(command) ||
    /unittest/i.test(command) ||
    /Ran \d+ test/.test(output)
  );
}

function detectGoTest(output: string, command: string): boolean {
  return (
    /\bgo\s+test/i.test(command) ||
    /=== RUN/.test(output) ||
    /--- PASS:|--- FAIL:/.test(output) ||
    /\.go\b/.test(command)
  );
}

function detectCargoTest(output: string, command: string): boolean {
  // Check command first - most reliable indicator
  if (/cargo\s+test/i.test(command) || /\.rs/.test(command)) {
    return true;
  }
  // Check for Cargo-specific output patterns
  return (
    /running \d+ test/.test(output) &&
    /^test\s+.+?\s+\.\.\.\s+(ok|FAILED)$/m.test(output)
  );
}

function detectRSpec(output: string, command: string): boolean {
  return (
    /rspec/i.test(command) ||
    /\.rb/.test(command) ||
    /Finished in/.test(output) ||
    /examples?,\s+\d+ failures?/.test(output)
  );
}

function detectMinitest(_output: string, command: string): boolean {
  return /minitest/i.test(command) || /ruby.*test/i.test(command);
}

function detectJUnit(output: string, command: string): boolean {
  return (
    /junit/i.test(command) ||
    /mvn\s+test/i.test(command) ||
    /\.java/.test(command) ||
    /Tests run:/.test(output)
  );
}

function detectTestNG(output: string, command: string): boolean {
  return /testng/i.test(command) || /TestNG/i.test(output);
}

function detectDotNetTest(output: string, command: string): boolean {
  return (
    /dotnet\s+test/i.test(command) ||
    /\.cs/.test(command) ||
    /Passed!\s+-\s+Failed:/i.test(output)
  );
}

function detectPHPUnit(output: string, command: string): boolean {
  return (
    /phpunit/i.test(command) ||
    /\.php/.test(command) ||
    /PHPUnit/.test(output) ||
    /OK \(\d+ tests?/.test(output)
  );
}

function detectVitestJest(output: string, command: string): boolean {
  return (
    /vitest|jest/i.test(command) ||
    /[✓✔✗✘×]\s+/.test(output) ||
    /\.(test|spec)\.(ts|tsx|js|jsx)/.test(command)
  );
}

function detectPlaywright(output: string, command: string): boolean {
  return (
    /playwright/i.test(command) ||
    (/playwright/i.test(output) && /(ok|failed)\s+\d+\s+/.test(output))
  );
}

function detectTAP(output: string, _command: string): boolean {
  // TAP format must start with "1..N" plan line
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l);
  if (lines.length === 0) return false;

  const firstLine = lines[0];
  // TAP format requires "1..N" as the first non-empty line
  return /^1\.\.\d+$/.test(firstLine);
}

// ============================================================================
// File Path Extractors
// ============================================================================

function extractPythonTestPath(command: string): string | null {
  const patterns = [
    /pytest\s+([^\s]+\.py)/i,
    /python.*-m\s+unittest\s+([^\s]+\.py)/i,
    /([^\s]+(?:test_|_test)\.py)/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractGoTestPath(command: string): string | null {
  const patterns = [/go\s+test\s+([^\s]+_test\.go)/i, /([^\s]+_test\.go)/i];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractRustTestPath(command: string): string | null {
  const patterns = [/cargo\s+test\s+([^\s]+\.rs)/i, /([^\s]+\.rs)/i];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractRubyTestPath(command: string): string | null {
  const patterns = [
    /rspec\s+([^\s]+(?:spec|test)\.rb)/i,
    /ruby.*test\s+([^\s]+\.rb)/i,
    /([^\s]+(?:_spec|_test)\.rb)/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractJavaTestPath(command: string): string | null {
  const patterns = [
    /mvn\s+test.*-Dtest=([^\s]+Test\.java)/i,
    /([^\s]+Test\.java)/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractDotNetTestPath(command: string): string | null {
  const patterns = [
    /dotnet\s+test\s+([^\s]+(?:Test|Tests)\.cs)/i,
    /([^\s]+(?:Test|Tests)\.cs)/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractPHPTestPath(command: string): string | null {
  const patterns = [/phpunit\s+([^\s]+Test\.php)/i, /([^\s]+Test\.php)/i];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extractJSTestPath(command: string): string | null {
  const patterns = [
    /(?:vitest|jest|playwright)\s+(?:run|test)\s+([^\s]+\.(test|spec)\.(tsx?|jsx?))/i,
    /npm\s+(?:test|run\s+test)\s+--\s+([^\s]+\.(test|spec)\.(tsx?|jsx?))/i,
    /([^\s]+\.(test|spec)\.(tsx?|jsx?))/i,
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

// ============================================================================
// Parser Registry
// ============================================================================

const testParsers: TestFrameworkParser[] = [
  {
    name: "pytest",
    detect: detectPytest,
    parse: parsePytestOutput,
    extractFilePath: extractPythonTestPath,
  },
  {
    name: "unittest",
    detect: detectUnittest,
    parse: parseUnittestOutput,
    extractFilePath: extractPythonTestPath,
  },
  {
    name: "go-test",
    detect: detectGoTest,
    parse: parseGoTestOutput,
    extractFilePath: extractGoTestPath,
  },
  {
    name: "cargo-test",
    detect: detectCargoTest,
    parse: parseCargoTestOutput,
    extractFilePath: extractRustTestPath,
  },
  {
    name: "rspec",
    detect: detectRSpec,
    parse: parseRSpecOutput,
    extractFilePath: extractRubyTestPath,
  },
  {
    name: "minitest",
    detect: detectMinitest,
    parse: parseMinitestOutput,
    extractFilePath: extractRubyTestPath,
  },
  {
    name: "junit",
    detect: detectJUnit,
    parse: parseJUnitOutput,
    extractFilePath: extractJavaTestPath,
  },
  {
    name: "testng",
    detect: detectTestNG,
    parse: parseTestNGOutput,
    extractFilePath: extractJavaTestPath,
  },
  {
    name: "dotnet-test",
    detect: detectDotNetTest,
    parse: parseDotNetTestOutput,
    extractFilePath: extractDotNetTestPath,
  },
  {
    name: "phpunit",
    detect: detectPHPUnit,
    parse: parsePHPUnitOutput,
    extractFilePath: extractPHPTestPath,
  },
  {
    name: "vitest-jest",
    detect: detectVitestJest,
    parse: parseVitestJestOutput,
    extractFilePath: extractJSTestPath,
  },
  {
    name: "playwright",
    detect: detectPlaywright,
    parse: parsePlaywrightOutput,
    extractFilePath: extractJSTestPath,
  },
  {
    name: "tap",
    detect: detectTAP,
    parse: parseTAPOutput,
  },
  {
    name: "generic",
    detect: () => true, // Always matches as fallback
    parse: parseGenericOutput,
  },
];

// ============================================================================
// Public API
// ============================================================================

/**
 * Detect if a command is a test command
 */
export function isTestCommand(command: string): boolean {
  const testPatterns = [
    /vitest\s+(run|test)/i,
    /jest\s+(test|run)/i,
    /playwright\s+test/i,
    /pytest/i,
    /python.*-m\s+unittest/i,
    /go\s+test/i,
    /cargo\s+test/i,
    /rspec/i,
    /ruby.*test/i,
    /mvn\s+test/i,
    /dotnet\s+test/i,
    /phpunit/i,
    /npm\s+(test|run\s+test)/i,
    /yarn\s+(test|run\s+test)/i,
    /pnpm\s+(test|run\s+test)/i,
    /npx\s+(vitest|jest|playwright)/i,
  ];

  return testPatterns.some((pattern) => pattern.test(command));
}

/**
 * Extract test file path from command
 */
export function extractTestFilePath(command: string): string | null {
  // Try each parser's extractFilePath function
  for (const parser of testParsers) {
    if (parser.extractFilePath) {
      const path = parser.extractFilePath(command);
      if (path) {
        return path;
      }
    }
  }

  return null;
}

/**
 * Parse test output from bashExecute tool result
 * Attempts to detect framework and parse accordingly
 */
export function parseTestOutput(
  output: unknown,
  command: string,
): TestResult[] {
  let outputStr = "";

  // Extract string from various output formats
  if (typeof output === "string") {
    outputStr = output;
  } else if (
    typeof output === "object" &&
    output !== null &&
    "stdout" in output &&
    typeof (output as { stdout: string }).stdout === "string"
  ) {
    outputStr = (output as { stdout: string }).stdout;
  } else {
    return [];
  }

  if (!outputStr.trim()) {
    return [];
  }

  // Try each parser in order until one matches
  for (const parser of testParsers) {
    if (parser.detect(outputStr, command)) {
      return parser.parse(outputStr);
    }
  }

  // Should never reach here due to generic parser, but just in case
  return parseGenericOutput(outputStr);
}

/**
 * Check if test output indicates completion (e.g., summary lines)
 */
function isTestOutputComplete(
  output: string,
  command: string,
  parsedResults?: TestResult[],
): boolean {
  const outputLower = output.toLowerCase();
  
  // If we have parsed results, check if all tests have durations
  // This indicates they completed (durations are only shown after completion)
  if (parsedResults && parsedResults.length > 0) {
    const allHaveDurations = parsedResults.every((r) => r.duration !== undefined);
    if (allHaveDurations) {
      return true;
    }
  }
  
  // Check for vitest/jest completion markers
  if (/vitest|jest/i.test(command)) {
    // Vitest completion markers: "Test Files", "Tests", summary lines
    return /Test Files\s+\d+/.test(output) || 
           /Tests\s+\d+/.test(output) ||
           /Test Files\s+\d+\s+(passed|failed)/.test(output);
  }
  
  // Check for pytest completion markers
  if (/pytest/i.test(command)) {
    return /passed|failed|error/.test(outputLower) && 
           /\d+\s+(passed|failed|error)/.test(output);
  }
  
  // Check for go test completion markers
  if (/go\s+test/i.test(command)) {
    return /^ok\s+/.test(output.trim()) || /^FAIL\s+/.test(output.trim());
  }
  
  // For other frameworks, assume incomplete during streaming
  // The caller can mark as complete when the process actually finishes
  return false;
}

/**
 * Update test execution from streaming output chunks
 * Accumulates output and parses incrementally as new chunks arrive
 */
export function updateTestExecutionFromStream(
  current: TestFileExecution | null,
  command: string,
  _outputChunk: string, // Unused - accumulatedOutput already contains this chunk
  accumulatedOutput: string,
): TestFileExecution | null {
  // accumulatedOutput already contains the chunk, so use it directly
  // The caller accumulates before calling: accumulated += chunk
  const fullOutput = accumulatedOutput;

  // Use the existing updateTestExecution function with the accumulated output
  const result = updateTestExecution(current, command, fullOutput);
  
  // During streaming, keep status as "running" unless we detect completion markers
  // Pass parsed results to help detect completion (e.g., all tests have durations)
  if (result && !isTestOutputComplete(fullOutput, command, result.tests)) {
    return {
      ...result,
      status: "running",
      completedAt: undefined,
    };
  }
  
  return result;
}

/**
 * Update test execution with new results from tool output
 */
export function updateTestExecution(
  current: TestFileExecution | null,
  command: string,
  output: unknown,
): TestFileExecution | null {
  const filePath = extractTestFilePath(command) || "unknown";

  // If no current execution or different file, create new one
  if (!current || current.filePath !== filePath) {
    const results = parseTestOutput(output, command);
    const hasFailures = results.some((r) => r.status === "fail");
    const allCompleted = results.every(
      (r) => r.status === "pass" || r.status === "fail",
    );

    return {
      filePath,
      status: allCompleted ? (hasFailures ? "failed" : "completed") : "running",
      tests: results,
      startedAt: new Date(),
      completedAt: allCompleted ? new Date() : undefined,
      summary: {
        total: results.length,
        passed: results.filter((r) => r.status === "pass").length,
        failed: results.filter((r) => r.status === "fail").length,
      },
    };
  }

  // Update existing execution for the same file
  const newResults = parseTestOutput(output, command);
  const allResults = [...current.tests];

  // Merge new results, updating existing tests or adding new ones
  for (const newResult of newResults) {
    const existingIndex = allResults.findIndex(
      (r) => r.testName === newResult.testName,
    );
    if (existingIndex >= 0) {
      allResults[existingIndex] = newResult;
    } else {
      allResults.push(newResult);
    }
  }

  const hasFailures = allResults.some((r) => r.status === "fail");
  const allCompleted = allResults.every(
    (r) => r.status === "pass" || r.status === "fail",
  );

  return {
    ...current,
    status: allCompleted ? (hasFailures ? "failed" : "completed") : "running",
    tests: allResults,
    completedAt: allCompleted ? new Date() : undefined,
    summary: {
      total: allResults.length,
      passed: allResults.filter((r) => r.status === "pass").length,
      failed: allResults.filter((r) => r.status === "fail").length,
    },
  };
}
