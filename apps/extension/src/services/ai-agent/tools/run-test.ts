import { tool } from "ai";
import { z } from "zod";
import { Effect, Runtime, Data } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { getWorkspaceRoot } from "../../../lib/vscode-effects.js";
import { DockerSandboxService } from "../../docker-sandbox.js";
import type { RunTestInput, RunTestOutput } from "../types.js";

const execAsync = promisify(exec);

class TestExecutionError extends Data.TaggedError("TestExecutionError")<{
  message: string;
  command: string;
  cause?: unknown;
}> {}

export const createRunTestTool = (approvalRegistry: Set<string>) =>
  tool({
    description: `Execute test commands with user approval.
    
IMPORTANT: This tool requires user approval before execution.
- Unit tests: Run directly without sandbox
- Integration/E2E tests: Start Docker sandbox first, set safe env vars

The tool will:
1. Request user approval (shows command and test type)
2. For integration/E2E: Start docker-compose services
3. For integration/E2E: Load sandbox env vars from .clive/.env.test
4. Execute the test command
5. Return results`,
    inputSchema: z.object({
      testType: z.enum(["unit", "integration", "e2e"]),
      command: z
        .string()
        .describe("Test command to run, e.g. 'npm run test:unit'"),
      testFile: z.string().optional().describe("Specific test file to run"),
      reason: z.string().describe("Why this test should be run"),
    }),
    execute: async ({
      testType,
      command,
      testFile,
      reason,
    }: RunTestInput): Promise<RunTestOutput> => {
      const program = Effect.gen(function* () {
        const approvalId = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

        if (!approvalRegistry.has(approvalId)) {
          return yield* Effect.succeed({
            status: "pending_approval" as const,
            approvalId,
            testType,
            command,
            testFile,
            reason,
            message: `Approval required to run ${testType} test: ${command}`,
          });
        }

        const workspaceRootUri = yield* getWorkspaceRoot();
        const workspaceRoot = workspaceRootUri.fsPath;

        const sandboxEnv: Record<string, string> = {};
        if (testType !== "unit") {
          yield* Effect.logDebug(
            `[RunTest] Starting Docker sandbox for ${testType} test`,
          );

          const dockerSandbox = yield* DockerSandboxService;

          yield* dockerSandbox.start();
          yield* dockerSandbox.waitForHealth();

          const envVars = yield* dockerSandbox.loadSandboxEnv();
          Object.assign(sandboxEnv, envVars);

          yield* Effect.logDebug(
            `[RunTest] Sandbox ready with env: ${Object.keys(sandboxEnv).join(", ")}`,
          );
        }

        yield* Effect.logDebug(`[RunTest] Executing: ${command}`);

        const result = yield* Effect.tryPromise({
          try: () =>
            execAsync(command, {
              cwd: workspaceRoot,
              timeout: 300_000, // 5 minute timeout for tests
              maxBuffer: 10 * 1024 * 1024,
              env: {
                ...process.env,
                ...sandboxEnv,
                NODE_ENV: "test",
              },
            }),
          catch: (error) =>
            new TestExecutionError({
              message: error instanceof Error ? error.message : "Unknown error",
              command,
              cause: error,
            }),
        });

        const output =
          result.stdout +
          (result.stderr ? `\n--- stderr ---\n${result.stderr}` : "");

        yield* Effect.logDebug(`[RunTest] Test completed successfully`);

        return {
          status: "completed" as const,
          testType,
          command,
          output,
          exitCode: 0,
          passed: true,
        };
      });

      return Runtime.runPromise(Runtime.defaultRuntime)(
        program.pipe(
          Effect.provide(DockerSandboxService.Default),
          Effect.catchTag("TestExecutionError", (error) =>
            Effect.succeed({
              status: "failed" as const,
              testType,
              command,
              output: error.message,
              exitCode: 1,
              passed: false,
              message: `Test execution failed: ${error.message}`,
            }),
          ),
          Effect.catchTag("DockerNotAvailableError", (error) =>
            Effect.succeed({
              status: "failed" as const,
              testType,
              command,
              message: `Docker not available: ${error.message}. Integration tests require Docker.`,
              passed: false,
            }),
          ),
          Effect.catchAll((error) =>
            Effect.succeed({
              status: "failed" as const,
              testType,
              command,
              message: `Unexpected error: ${error instanceof Error ? error.message : "Unknown"}`,
              passed: false,
            }),
          ),
        ),
      );
    },
  });
