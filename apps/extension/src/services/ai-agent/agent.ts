import type * as vscode from "vscode";
import { PlanningAgent } from "./planning-agent.js";
import { ExecutionAgent } from "./execution-agent.js";
import type {
  GenerateTestInput,
  GenerateTestOutput,
  TestGenerationPlan,
  ExecuteTestInput,
  ExecuteTestOutput,
} from "./types.js";

/**
 * Facade for Cypress test generation agents
 * Delegates to specialized PlanningAgent and ExecutionAgent
 */
export class CypressTestAgent {
  private planningAgent: PlanningAgent;
  private executionAgent: ExecutionAgent;

  constructor() {
    this.planningAgent = new PlanningAgent();
    this.executionAgent = new ExecutionAgent();
  }

  /**
   * Check if the agent is properly configured
   */
  isConfigured(): boolean {
    return this.planningAgent.isConfigured();
  }

  /**
   * Plan Cypress tests for multiple React components
   * Uses PlanningAgent with Claude Opus 4.5 for intelligent analysis
   */
  async planTests(
    files: string[],
    outputChannel?: vscode.OutputChannel,
  ): Promise<TestGenerationPlan> {
    return this.planningAgent.planTests(files, outputChannel);
  }

  /**
   * Execute a test proposal by writing the Cypress test file
   * Uses ExecutionAgent with Claude Haiku for fast execution
   */
  async executeTest(
    input: ExecuteTestInput,
    outputChannel?: vscode.OutputChannel,
  ): Promise<ExecuteTestOutput> {
    return this.executionAgent.executeTest(input, outputChannel);
  }

  /**
   * Generate Cypress test for a React component
   * Legacy method - maintains backward compatibility
   * For new code, prefer using planTests() + executeTest() workflow
   */
  async generateTest(
    input: GenerateTestInput,
    outputChannel?: vscode.OutputChannel,
  ): Promise<GenerateTestOutput> {
    // For backward compatibility, we can still generate tests directly
    // This uses the execution agent with a simplified approach
    // In practice, this should be replaced with planTests + executeTest workflow
    const executeInput: ExecuteTestInput = {
      sourceFile: input.sourceFilePath,
      targetTestPath: "", // Will be determined by the agent
      description: `Generate Cypress E2E test for ${input.sourceFilePath}`,
      isUpdate: input.options?.updateExisting ?? false,
    };

    const result = await this.executionAgent.executeTest(
      executeInput,
      outputChannel,
    );

    return {
      success: result.success,
      testFilePath: result.testFilePath,
      testContent: result.testContent,
      error: result.error,
    };
  }
}
