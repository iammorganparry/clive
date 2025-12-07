import type * as vscode from "vscode";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  readFileTool,
  listFilesTool,
  getCypressConfigTool,
  writeTestFileTool,
} from "./tools/index.js";
import type { ConfigService } from "../config-service.js";
import type {
  ExecuteTestInput,
  ExecuteTestOutput,
  WriteTestFileOutput,
} from "./types.js";
import { Effect, Runtime } from "effect";
import { VSCodeService } from "../vs-code.js";

/**
 * System prompt for Cypress test execution
 * Focused on writing test files based on approved proposals
 */
const CYPRESS_EXECUTION_PROMPT = `You are an expert Cypress E2E test writer. Your task is to write comprehensive Cypress test files based on approved test proposals.

## Your Responsibilities

1. **Read the component**: Read and understand the React component file that needs testing
2. **Read Cypress config**: Understand the Cypress configuration to follow project conventions
3. **Write the test**: Generate a complete, runnable Cypress test file that covers:
   - Component rendering and visibility
   - User interactions (clicks, typing, form submissions)
   - Navigation and routing
   - API calls and data loading
   - Error states and edge cases
   - Accessibility (if applicable)

## Test Writing Guidelines

- Use Cypress best practices and modern syntax (cy.get(), cy.findByRole(), etc.)
- Follow the existing test structure if tests already exist
- Use descriptive test names that explain what is being tested
- Group related tests using describe blocks
- Use beforeEach/afterEach hooks appropriately
- Mock API calls when necessary
- Test user flows, not implementation details
- Include assertions for both positive and negative cases
- Write complete, runnable test files

## Important Notes

- The test proposal has already been approved - you just need to write the test file
- Read the component file to understand what needs to be tested
- Read Cypress config to understand project setup and conventions
- Write the test file to the specified target path
- If isUpdate is true, update the existing test file; otherwise create a new one`;

/**
 * Execution Agent for writing Cypress test files
 * Uses Claude Haiku for fast, cost-effective test file generation
 */
export class ExecutionAgent {
  constructor(private configService: ConfigService) {}

  /**
   * Check if the agent is properly configured
   */
  async isConfigured(): Promise<boolean> {
    return await this.configService
      .isConfigured()
      .pipe(
        Effect.provide(VSCodeService.Default),
        Runtime.runPromise(Runtime.defaultRuntime),
      );
  }

  /**
   * Execute a test proposal by writing the Cypress test file
   * Takes an approved proposal and generates the actual test file
   */
  async executeTest(
    input: ExecuteTestInput,
    outputChannel?: vscode.OutputChannel,
  ): Promise<ExecuteTestOutput> {
    if (!(await this.isConfigured())) {
      return {
        success: false,
        error:
          "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
      };
    }

    const log = (message: string) => {
      if (outputChannel) {
        outputChannel.appendLine(`[Execution Agent] ${message}`);
      }
      console.log(`[Execution Agent] ${message}`);
    };

    try {
      log(`Executing test generation for: ${input.sourceFile}`);

      // Create tool set for execution (minimal tools needed)
      const tools = {
        readFile: readFileTool,
        listFiles: listFilesTool,
        getCypressConfig: getCypressConfigTool,
        writeTestFile: writeTestFileTool,
      };

      // Build prompt for execution
      const prompt = `Write a comprehensive Cypress E2E test file for the React component at: ${input.sourceFile}

        Target test path: ${input.targetTestPath}
        Description: ${input.description}
        ${input.isUpdate ? "Update the existing test file if it exists." : "Create a new test file."}

        Please:
        1. Read and understand the component file
        2. Read Cypress configuration to understand project conventions
        3. Write a complete, runnable Cypress test file to ${input.targetTestPath}

        The test should cover: ${input.description}

        Start by reading the component file and Cypress config, then write the test file.`;

      log("Calling AI model for execution...");
      const apiKey = await this.configService
        .getAiApiKey()
        .pipe(
          Effect.provide(VSCodeService.Default),
          Runtime.runPromise(Runtime.defaultRuntime),
        );

      if (!apiKey) {
        return {
          success: false,
          error: "Anthropic API key not configured",
        };
      }

      const anthropic = createAnthropic({
        apiKey,
      });

      const result = await generateText({
        model: anthropic("claude-3-5-haiku-latest"),
        tools,
        stopWhen: stepCountIs(10), // Fewer steps needed since we're just executing
        system: CYPRESS_EXECUTION_PROMPT,
        prompt,
      });

      log(`Execution completed. Steps: ${result.steps.length}`);

      // Extract structured data from tool results
      let testFilePath: string | undefined;
      let success = false;
      let message = "Test execution completed";

      const writeResults = result.steps
        .flatMap((step) => step.toolResults)
        .filter((toolResult) => toolResult.toolName === "writeTestFile");

      if (writeResults.length > 0) {
        const lastWrite = writeResults[writeResults.length - 1];
        // Type guard to check if output matches WriteTestFileOutput structure
        const isWriteTestFileOutput = (
          value: unknown,
        ): value is WriteTestFileOutput => {
          return (
            typeof value === "object" &&
            value !== null &&
            "filePath" in value &&
            "success" in value &&
            "message" in value &&
            typeof (value as WriteTestFileOutput).filePath === "string"
          );
        };

        // Tool results use 'result' property for the output
        const toolOutput = "result" in lastWrite ? lastWrite.result : undefined;
        if (toolOutput && isWriteTestFileOutput(toolOutput)) {
          testFilePath = toolOutput.filePath;
          success = toolOutput.success;
          message = toolOutput.message;
        }
      } else {
        // No test file was written
        success = false;
        message =
          "Test execution completed but no test file was written. The model may have encountered an issue or decided not to create a test file.";
      }

      return {
        success,
        testFilePath,
        testContent: message,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log(`Error: ${errorMessage}`);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}
