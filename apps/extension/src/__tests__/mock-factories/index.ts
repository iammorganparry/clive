/**
 * Centralized mock factories for unit tests
 * Re-exports all mock factories for convenient importing
 */

export {
  createVSCodeMock,
  setupVSCodeMock,
  resetVSCodeMock,
  getVSCodeMock,
  type VSCodeMockOverrides,
} from "./vscode-mock.js";

export {
  createMockChildProcess,
  createMockSpawn,
  createMockSpawnWithChild,
  type MockChildProcess,
  type ChildProcessHandlers,
} from "./child-process-mock.js";

export {
  createMockTokenBudgetService,
  createMockSummaryService,
  createMockKnowledgeFileService,
  createMockDiffContentProvider,
  createMockStreamingWrite,
  createMockPlanStreaming,
  createMockVSCodeServiceLayer,
  type StreamingWriteMockOverrides,
  type PlanStreamingMockOverrides,
} from "./service-mocks.js";

export {
  createMockDiagnostic,
  createMockDiagnosticWithRange,
  createPrePostDiagnosticScenario,
} from "./diagnostics-mock.js";
