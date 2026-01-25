/**
 * Centralized mock factories for unit tests
 * Re-exports all mock factories for convenient importing
 */

export {
  type ChildProcessHandlers,
  createMockChildProcess,
  createMockSpawn,
  createMockSpawnWithChild,
  type MockChildProcess,
} from "./child-process-mock.js";
export {
  createMockDiagnostic,
  createMockDiagnosticWithRange,
  createPrePostDiagnosticScenario,
} from "./diagnostics-mock.js";

export {
  type ClaudeCliServiceMockOverrides,
  createMockClaudeCliServiceLayer,
  createMockDiffContentProvider,
  createMockKnowledgeFileService,
  createMockPlanStreaming,
  createMockStreamingWrite,
  createMockSummaryService,
  createMockTokenBudgetService,
  createMockVSCodeServiceLayer,
  type PlanStreamingMockOverrides,
  type StreamingWriteMockOverrides,
} from "./service-mocks.js";
export {
  createVSCodeMock,
  getVSCodeMock,
  resetVSCodeMock,
  setupVSCodeMock,
  type VSCodeMockOverrides,
} from "./vscode-mock.js";
