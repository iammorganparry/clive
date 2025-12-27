/**
 * Centralized mock factories for unit tests
 * Re-exports all mock factories for convenient importing
 */

export {
  createVSCodeMock,
  setupVSCodeMock,
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
} from "./service-mocks.js";

