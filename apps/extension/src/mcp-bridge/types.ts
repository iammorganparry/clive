/**
 * Types for the MCP bridge infrastructure
 * Defines the communication protocol between MCP server and VSCode extension
 */

/**
 * Request from MCP server to extension via IPC
 */
export interface BridgeRequest {
  id: string;
  method: string;
  params: unknown;
}

/**
 * Response from extension to MCP server
 */
export interface BridgeResponse {
  id: string;
  result?: unknown;
  error?: string;
}

/**
 * Handler function for bridge methods
 */
export type BridgeHandler<TParams = unknown, TResult = unknown> = (
  params: TParams,
) => Promise<TResult>;

/**
 * Map of method names to their handlers
 * Includes typed handlers for known methods and index signature for extensibility
 */
export interface BridgeHandlers {
  proposePlan?: (params: unknown) => Promise<ProposePlanBridgeResponse>;
  proposeTestPlan?: (params: unknown) => Promise<ProposeTestPlanBridgeResponse>;
  approvePlan?: (params: unknown) => Promise<ApprovePlanBridgeResponse>;
  summarizeContext?: (
    params: unknown,
  ) => Promise<SummarizeContextBridgeResponse>;
  [method: string]: BridgeHandler | undefined;
}

/**
 * Typed bridge handlers returned by createBridgeHandlers
 * All methods are guaranteed to exist
 * Extends BridgeHandlers for compatibility with functions expecting partial handlers
 */
export interface TypedBridgeHandlers extends BridgeHandlers {
  proposePlan: (params: unknown) => Promise<ProposePlanBridgeResponse>;
  proposeTestPlan: (params: unknown) => Promise<ProposeTestPlanBridgeResponse>;
  approvePlan: (params: unknown) => Promise<ApprovePlanBridgeResponse>;
  summarizeContext: (params: unknown) => Promise<SummarizeContextBridgeResponse>;
}

/**
 * MCP bridge status for UI display
 */
export interface McpBridgeStatus {
  bridgeReady: boolean;
  starting: boolean;
  error: string | null;
  socketPath: string | null;
}

/**
 * proposePlan bridge params (new user story format)
 */
export interface ProposePlanBridgeParams {
  name: string;
  overview: string;
  category: "feature" | "bugfix" | "refactor" | "docs";
  epicUserStory: {
    role: string;
    capability: string;
    benefit: string;
  };
  scope?: {
    inScope: string[];
    outOfScope: string[];
  };
  successCriteria?: string[];
  tasks: Array<{
    id: string;
    title: string;
    userStory?: {
      role: string;
      capability: string;
      benefit: string;
    };
    acceptanceCriteria: string[];
    definitionOfDone: string[];
    skill: "feature" | "bugfix" | "refactor" | "docs" | "unit-tests" | "e2e-tests";
    complexity: number;
    estimatedEffort?: string;
    dependencies?: string[];
    technicalNotes: string;
    outOfScope?: string;
  }>;
  risks?: Array<{
    description: string;
    mitigation: string;
  }>;
  dependencies?: string[];
  verificationPlan?: string[];
  planContent: string;
  toolCallId: string;
}

/**
 * proposePlan bridge response
 */
export interface ProposePlanBridgeResponse {
  success: boolean;
  planId: string;
  filePath?: string;
  message: string;
}

/**
 * proposeTestPlan bridge params (DEPRECATED - use ProposePlanBridgeParams)
 */
export interface ProposeTestPlanBridgeParams {
  name: string;
  overview: string;
  planContent: string;
  suites: Array<{
    id: string;
    name: string;
    testType: "unit" | "integration" | "e2e";
    targetFilePath: string;
    sourceFiles: string[];
    description?: string;
  }>;
  mockDependencies: Array<{
    dependency: string;
    existingMock?: string;
    mockStrategy: "factory" | "inline" | "spy";
  }>;
  discoveredPatterns: {
    testFramework: string;
    mockFactoryPaths: string[];
    testPatterns: string[];
  };
  toolCallId: string;
}

/**
 * approvePlan bridge params
 */
export interface ApprovePlanBridgeParams {
  approved: boolean;
  planId?: string;
}

/**
 * summarizeContext bridge params
 */
export interface SummarizeContextBridgeParams {
  summary: string;
  tokensBefore: number;
  tokensAfter: number;
}

/**
 * searchKnowledge bridge params
 */
export interface SearchKnowledgeBridgeParams {
  query: string;
  limit?: number;
}

/**
 * completeTask bridge params
 */
export interface CompleteTaskBridgeParams {
  summary: string;
  testsWritten: number;
  testsPassed: number;
  confirmation: boolean;
}

/**
 * proposeTestPlan bridge response
 */
export interface ProposeTestPlanBridgeResponse {
  success: boolean;
  planId: string;
  filePath?: string;
  message: string;
}

/**
 * approvePlan bridge response
 */
export interface ApprovePlanBridgeResponse {
  success: boolean;
  mode: "plan" | "act";
  message: string;
}

/**
 * summarizeContext bridge response
 */
export interface SummarizeContextBridgeResponse {
  success: boolean;
  tokensBefore: number;
  tokensAfter: number;
  message: string;
}
