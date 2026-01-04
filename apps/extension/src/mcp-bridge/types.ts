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
 */
export interface BridgeHandlers {
  [method: string]: BridgeHandler;
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
 * proposeTestPlan bridge params
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
