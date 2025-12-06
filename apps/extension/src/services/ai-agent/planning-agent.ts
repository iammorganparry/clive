import * as vscode from "vscode";
import { generateText, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  readFileTool,
  listFilesTool,
  grepSearchTool,
  globSearchTool,
  getCypressConfigTool,
  proposeTestTool,
  writeTestFileTool,
} from "./tools/index.js";
import type {
  ProposedTest,
  TestGenerationPlan,
  ProposeTestOutput,
} from "./types.js";

/**
 * System prompt for Cypress test planning (proposal phase)
 */
const CYPRESS_PLANNING_PROMPT = `You are an expert Cypress E2E test planner. Your task is to analyze React components and propose comprehensive Cypress test files WITHOUT writing them.

## Your Responsibilities

1. **Analyze components**: Read and understand each React component's structure, props, state, and behavior
2. **Explore dependencies**: Find related files (routes, API calls, types, utilities) that components use
3. **Check existing tests**: Look for existing Cypress tests to determine if updates are needed
4. **Read Cypress config**: Understand the Cypress configuration to follow project conventions
5. **Propose tests**: Use the proposeTest tool to suggest test files that would cover:
   - Component rendering and visibility
   - User interactions (clicks, typing, form submissions)
   - Navigation and routing
   - API calls and data loading
   - Error states and edge cases
   - Accessibility (if applicable)

## Planning Guidelines

- Use proposeTest tool for EACH component that needs a test
- Check if a test already exists - if so, propose an update (isUpdate: true)
- Follow the project's naming conventions (usually \`.cy.ts\` or \`.spec.ts\`)
- Match the component's directory structure in the test directory
- Provide clear descriptions of what each test will cover

## Important Notes

- DO NOT use writeTestFile tool - only use proposeTest
- Always read the component file first to understand what needs testing
- Use grepSearch to find where components are used to understand context
- Read Cypress config to understand project setup and conventions
- Propose one test file per component`;

/**
 * Planning Agent for analyzing components and proposing Cypress tests
 * Uses Claude Opus 4.5 for intelligent analysis and planning
 */
export class PlanningAgent {
  private apiKey: string | undefined;

  constructor() {
    // Get API key from VS Code configuration
    const config = vscode.workspace.getConfiguration("clive");
    this.apiKey = config.get<string>("anthropicApiKey");

    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("clive.anthropicApiKey")) {
        const newConfig = vscode.workspace.getConfiguration("clive");
        this.apiKey = newConfig.get<string>("anthropicApiKey");
      }
    });
  }

  /**
   * Check if the agent is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  /**
   * Generate test content for a proposed test without writing it
   * Returns both proposed content and existing content (if update)
   */
  private async generateTestContent(
    test: ProposedTest,
    outputChannel?: vscode.OutputChannel,
  ): Promise<{ proposedContent: string; existingContent?: string }> {
    const log = (message: string) => {
      if (outputChannel) {
        outputChannel.appendLine(`[Planning Agent] ${message}`);
      }
      console.log(`[Planning Agent] ${message}`);
    };

    // Read existing content if this is an update
    let existingContent: string | undefined;
    if (test.isUpdate) {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri;
          const fileUri = vscode.Uri.joinPath(
            workspaceRoot,
            test.targetTestPath,
          );
          const fileData = await vscode.workspace.fs.readFile(fileUri);
          existingContent = Buffer.from(fileData).toString("utf-8");
        }
      } catch {
        // File doesn't exist, that's okay
        existingContent = undefined;
      }
    }

    // Create tool set for content generation (same as execution but we'll capture content)
    const tools = {
      readFile: readFileTool,
      listFiles: listFilesTool,
      getCypressConfig: getCypressConfigTool,
      writeTestFile: writeTestFileTool, // We'll capture the content from tool calls
    };

    // Build prompt for content generation (same as execution)
    const prompt = `Write a comprehensive Cypress E2E test file for the React component at: ${test.sourceFile}

      Target test path: ${test.targetTestPath}
      Description: ${test.description}
      ${test.isUpdate ? "Update the existing test file if it exists." : "Create a new test file."}

      Please:
      1. Read and understand the component file
      2. Read Cypress configuration to understand project conventions
      3. Write a complete, runnable Cypress test file to ${test.targetTestPath}

      The test should cover: ${test.description}

      Start by reading the component file and Cypress config, then write the test file.`;

    const anthropic = createAnthropic({
      apiKey: this.apiKey,
    });

    const result = await generateText({
      model: anthropic("claude-3-5-haiku-latest"),
      tools,
      stopWhen: stepCountIs(10),
      system: `You are an expert Cypress E2E test writer. Generate comprehensive Cypress test files.
      
      Read the component file and Cypress config, then generate a complete test file.
      Use the writeTestFile tool to provide the test content.`,
      prompt,
    });

    // Extract test content from writeTestFile tool calls
    let proposedContent = "";
    const writeCalls = result.steps
      .flatMap((step) => step.toolCalls)
      .filter((call) => call.toolName === "writeTestFile");

    if (writeCalls.length > 0) {
      const lastCall = writeCalls[writeCalls.length - 1];
      if ("args" in lastCall && typeof lastCall.args === "object") {
        const args = lastCall.args as { testContent?: string };
        if (args.testContent) {
          proposedContent = args.testContent;
        }
      }
    }

    // If no content was captured, use a fallback
    if (!proposedContent) {
      proposedContent = `// Test content generation in progress...\n// Target: ${test.targetTestPath}\n// Description: ${test.description}`;
    }

    return { proposedContent, existingContent };
  }

  /**
   * Plan Cypress tests for multiple React components
   * Analyzes files and proposes test files without writing them
   */
  async planTests(
    files: string[],
    outputChannel?: vscode.OutputChannel,
  ): Promise<TestGenerationPlan> {
    if (!this.isConfigured()) {
      throw new Error(
        "Anthropic API key not configured. Please set 'clive.anthropicApiKey' in VS Code settings.",
      );
    }

    const log = (message: string) => {
      if (outputChannel) {
        outputChannel.appendLine(`[Planning Agent] ${message}`);
      }
      console.log(`[Planning Agent] ${message}`);
    };

    try {
      log(`Starting test planning for ${files.length} file(s)`);

      // Create tool set for planning (read-only tools + proposeTest)
      const tools = {
        readFile: readFileTool,
        listFiles: listFilesTool,
        grepSearch: grepSearchTool,
        globSearch: globSearchTool,
        getCypressConfig: getCypressConfigTool,
        proposeTest: proposeTestTool,
      };

      // Build prompt for planning
      const fileList = files.map((f, i) => `${i + 1}. ${f}`).join("\n");
      const prompt = `Analyze the following React component files and propose Cypress E2E tests for each:

        ${fileList}

        For each component:
        1. Read and analyze the component file
        2. Explore related files (imports, routes, API calls)
        3. Check for existing Cypress tests
        4. Read Cypress configuration
        5. Use the proposeTest tool to propose a test file

        Propose one test file per component. Start by reading the Cypress config and then analyze each component.`;

      log("Calling AI model for planning...");
      const anthropic = createAnthropic({
        apiKey: this.apiKey,
      });

      const result = await generateText({
        model: anthropic("claude-opus-4-5"),
        tools,
        stopWhen: stepCountIs(20), // Allow more steps for multiple files
        system: CYPRESS_PLANNING_PROMPT,
        prompt,
      });

      log(`Planning completed. Steps: ${result.steps.length}`);

      // Extract ProposedTest objects from tool results
      const proposedTests: ProposedTest[] = [];
      const proposeResults = result.steps
        .flatMap((step) => step.toolResults)
        .filter((toolResult) => toolResult.toolName === "proposeTest");

      for (const toolResult of proposeResults) {
        const toolOutput =
          "result" in toolResult ? toolResult.result : undefined;
        if (toolOutput) {
          const isProposeTestOutput = (
            value: unknown,
          ): value is ProposeTestOutput => {
            return (
              typeof value === "object" &&
              value !== null &&
              "success" in value &&
              "id" in value &&
              "message" in value &&
              typeof (value as ProposeTestOutput).success === "boolean"
            );
          };

          if (isProposeTestOutput(toolOutput) && toolOutput.success) {
            // Extract input from tool call to build ProposedTest
            const toolCall = result.steps
              .flatMap((step) => step.toolCalls)
              .find((call) => call.toolCallId === toolResult.toolCallId);

            if (toolCall && "args" in toolCall) {
              const args = toolCall.args as {
                sourceFile: string;
                targetTestPath: string;
                description: string;
                isUpdate: boolean;
              };

              proposedTests.push({
                id: toolOutput.id,
                sourceFile: args.sourceFile,
                targetTestPath: args.targetTestPath,
                description: args.description,
                isUpdate: args.isUpdate,
                proposedContent: "", // Will be populated during content generation
                existingContent: undefined, // Will be populated during content generation if update
              });
            }
          }
        }
      }

      log(`Proposed ${proposedTests.length} test file(s)`);

      // Generate test content for each proposed test
      const testsWithContent: ProposedTest[] = [];
      for (const test of proposedTests) {
        log(`Generating content for test: ${test.targetTestPath}`);
        try {
          const { proposedContent, existingContent } =
            await this.generateTestContent(test, outputChannel);
          testsWithContent.push({
            ...test,
            proposedContent,
            existingContent,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          log(
            `Failed to generate content for ${test.targetTestPath}: ${errorMessage}`,
          );
          // Still include the test but with empty content
          testsWithContent.push({
            ...test,
            proposedContent: `// Failed to generate content: ${errorMessage}`,
            existingContent: undefined,
          });
        }
      }

      return {
        tests: testsWithContent,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      log(`Error during planning: ${errorMessage}`);
      throw error;
    }
  }
}
