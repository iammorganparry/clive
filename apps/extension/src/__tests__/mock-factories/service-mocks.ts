/**
 * Shared service mock factories for unit tests
 * Provides reusable mocks for non-Effect services used in AI agent tools
 */

import { vi, } from "vitest";
import { Effect } from "effect";
import type { TokenBudgetService } from "../../services/ai-agent/token-budget.js";
import type { SummaryService } from "../../services/ai-agent/summary-service.js";
import type { KnowledgeFileService } from "../../services/knowledge-file-service.js";
import type { DiffContentProvider } from "../../services/diff-content-provider.js";
import type { Message } from "../../services/ai-agent/context-tracker.js";

/**
 * Create a mock TokenBudgetService for testing
 * Since the tool takes TokenBudgetService as a parameter (not from Effect context),
 * we create a plain object but use Effect patterns for testing
 */
export function createMockTokenBudgetService(
  overrides?: Partial<TokenBudgetService>,
): TokenBudgetService {
  return {
    truncateToFit:
      overrides?.truncateToFit ??
      vi.fn((content: string, _priority?: "high" | "medium" | "low") =>
        Effect.succeed({ content, wasTruncated: false }),
      ),
    consume: overrides?.consume ?? vi.fn(() => Effect.void),
    remaining: overrides?.remaining ?? vi.fn(() => Effect.succeed(100000)),
    getConsumed: overrides?.getConsumed ?? vi.fn(() => Effect.succeed(0)),
    getMaxBudget: overrides?.getMaxBudget ?? vi.fn(() => Effect.succeed(120000)),
  } as unknown as TokenBudgetService;
}

/**
 * Create a mock SummaryService for testing
 */
export function createMockSummaryService(
  overrides?: Partial<SummaryService>,
): SummaryService {
  return {
    summarizeMessages:
      overrides?.summarizeMessages ??
      vi.fn(
        (
          _messagesToSummarize: Message[],
          _model: unknown,
          _focus?: string,
          _persistentContext?: string,
        ) => Effect.succeed("Summary of messages"),
      ),
  } as unknown as SummaryService;
}

/**
 * Create a mock KnowledgeFileService for testing
 */
export interface KnowledgeFileServiceOverrides {
  writeKnowledgeFile?: KnowledgeFileService["writeKnowledgeFile"];
  readKnowledgeFile?: KnowledgeFileService["readKnowledgeFile"];
  listKnowledgeFiles?: KnowledgeFileService["listKnowledgeFiles"];
  grepKnowledge?: KnowledgeFileService["grepKnowledge"];
  knowledgeBaseExists?: KnowledgeFileService["knowledgeBaseExists"];
}

export function createMockKnowledgeFileService(
  overrides?: KnowledgeFileServiceOverrides,
): KnowledgeFileService {
  return {
    writeKnowledgeFile:
      overrides?.writeKnowledgeFile ??
      vi.fn(() =>
        Effect.succeed({
          path: "/test-workspace/.clive/knowledge/test-category.md",
          relativePath: ".clive/knowledge/test-category.md",
        }),
      ),
    readKnowledgeFile:
      overrides?.readKnowledgeFile ??
      vi.fn(() =>
        Effect.succeed({
          path: "/test-workspace/.clive/knowledge/test-category.md",
          relativePath: ".clive/knowledge/test-category.md",
          metadata: {
            category: "patterns" as const,
            title: "Test Pattern",
            updatedAt: new Date().toISOString(),
          },
          content: "Test content",
        }),
      ),
    listKnowledgeFiles:
      overrides?.listKnowledgeFiles ??
      vi.fn(() =>
        Effect.succeed([
          {
            relativePath: ".clive/knowledge/test-execution.md",
            path: "/test/test-execution.md",
          },
          {
            relativePath: ".clive/knowledge/architecture.md",
            path: "/test/architecture.md",
          },
        ]),
      ),
    grepKnowledge:
      overrides?.grepKnowledge ?? vi.fn(() => Effect.succeed([])),
    knowledgeBaseExists:
      overrides?.knowledgeBaseExists ?? vi.fn(() => Effect.succeed(true)),
  } as unknown as KnowledgeFileService;
}

/**
 * Create a mock DiffContentProvider for testing
 */
export function createMockDiffContentProvider(
  overrides?: Partial<DiffContentProvider>,
): DiffContentProvider {
  return {
    storeContent:
      overrides?.storeContent ??
      vi.fn((_testId: string, _content: string, _type?: string) => {
        return {
          fsPath: "",
          scheme: "clive-diff",
          path: "",
          toString: () => "clive-diff://proposed/test-id",
        } as unknown as ReturnType<DiffContentProvider["storeContent"]>;
      }),
    getUri:
      overrides?.getUri ??
      vi.fn((_testId: string) => {
        return {
          fsPath: "",
          scheme: "clive-diff",
          path: "",
          toString: () => "clive-diff://proposed/test-id",
        } as unknown as ReturnType<DiffContentProvider["getUri"]>;
      }),
    provideTextDocumentContent:
      overrides?.provideTextDocumentContent ??
      vi.fn(() => ""),
    onDidChange: {
      // Mock EventEmitter-like interface
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      fire: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      dispose: vi.fn(),
    } as unknown as DiffContentProvider["onDidChange"],
  } as unknown as DiffContentProvider;
}

/**
 * Streaming write tool mock overrides
 */
export interface StreamingWriteMockOverrides {
  initializeStreamingWrite?: () => Promise<{ success: boolean; error?: string }>;
  appendStreamingContent?: () => Promise<{ success: boolean; error?: string }>;
  finalizeStreamingWrite?: () => Promise<{ success: boolean; filePath: string; error?: string }>;
}

/**
 * Create mock streaming write functions for writeTestFile tool
 */
export function createMockStreamingWrite(overrides?: StreamingWriteMockOverrides) {
  return {
    initializeStreamingWrite:
      overrides?.initializeStreamingWrite ??
      vi.fn().mockResolvedValue({ success: true }),
    appendStreamingContent:
      overrides?.appendStreamingContent ??
      vi.fn().mockResolvedValue({ success: true }),
    finalizeStreamingWrite:
      overrides?.finalizeStreamingWrite ??
      vi.fn().mockResolvedValue({ success: true, filePath: "/test.ts" }),
  };
}

/**
 * Plan streaming mock overrides
 */
export interface PlanStreamingMockOverrides {
  initializePlanStreamingWriteEffect?: () => Effect.Effect<void>;
  appendPlanStreamingContentEffect?: () => Effect.Effect<void>;
  finalizePlanStreamingWriteEffect?: () => Effect.Effect<string>;
}

/**
 * Create mock plan streaming functions for proposeTestPlan tool
 */
export function createMockPlanStreaming(overrides?: PlanStreamingMockOverrides) {
  return {
    initializePlanStreamingWriteEffect:
      overrides?.initializePlanStreamingWriteEffect ??
      vi.fn(() => Effect.void),
    appendPlanStreamingContentEffect:
      overrides?.appendPlanStreamingContentEffect ??
      vi.fn(() => Effect.void),
    finalizePlanStreamingWriteEffect:
      overrides?.finalizePlanStreamingWriteEffect ??
      vi.fn(() => Effect.succeed("/test-plan.md")),
  };
}

