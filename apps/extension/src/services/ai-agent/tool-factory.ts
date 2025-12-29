/**
 * Tool Factory Module
 * Provides declarative tool configuration for the testing agent
 * Handles mode-based tool selection and callback wiring
 */

import { Effect } from "effect";
import type { DiffContentProvider } from "../diff-content-provider.js";
import type { KnowledgeFileService } from "../knowledge-file-service.js";
import type { SummaryService } from "./summary-service.js";
import type { Message } from "./context-tracker.js";
import type { TokenBudget } from "./token-budget.js";
import {
  createBashExecuteTool,
  createSearchKnowledgeTool,
  createSummarizeContextTool,
  createWebTools,
  createWriteKnowledgeFileTool,
  createWriteTestFileTool,
  createProposeTestPlanTool,
  createCompleteTaskTool,
  createReplaceInFileTool,
  createApprovePlanTool,
} from "./tools/index.js";
import type { LanguageModel } from "ai";

/**
 * Streaming callback for bash command output
 */
export type BashStreamingCallback = (chunk: {
  command: string;
  output: string;
}) => void;

/**
 * Streaming callback for file output
 */
export type FileStreamingCallback = (chunk: {
  filePath: string;
  content: string;
  isComplete: boolean;
}) => void;

/**
 * Callback for knowledge retrieval
 */
export type KnowledgeRetrievedCallback = (
  results: Array<{
    category: string;
    title: string;
    content: string;
    path: string;
  }>,
) => void;

/**
 * Tool configuration for the testing agent
 */
export interface ToolConfig {
  mode: "plan" | "act";
  budget: TokenBudget;
  firecrawlEnabled: boolean;
  diffProvider?: DiffContentProvider;
  knowledgeFileService: KnowledgeFileService;
  summaryService: SummaryService;
  summaryModel: LanguageModel; // LanguageModel from ai SDK
  getMessages: Effect.Effect<Message[]>;
  setMessages: (messages: Message[]) => Effect.Effect<void>;
  getKnowledgeContext: Effect.Effect<string>;
  progressCallback?: (status: string, message: string) => void;
  bashStreamingCallback?: BashStreamingCallback;
  fileStreamingCallback?: FileStreamingCallback;
  onKnowledgeRetrieved?: KnowledgeRetrievedCallback;
  waitForApproval?: (toolCallId: string) => Promise<unknown>;
}

/**
 * Create base tools available in both plan and act modes
 */
const createBaseTools = (config: ToolConfig) =>
  Effect.sync(() => {
    const bashExecute = createBashExecuteTool(
      config.budget,
      config.bashStreamingCallback,
    );

    const searchKnowledge = createSearchKnowledgeTool(
      config.knowledgeFileService,
      config.onKnowledgeRetrieved,
    );

    const summarizeContext = createSummarizeContextTool(
      config.summaryService,
      config.summaryModel,
      config.getMessages,
      config.setMessages,
      config.progressCallback,
      config.getKnowledgeContext,
    );

    const proposeTestPlan = createProposeTestPlanTool(
      config.fileStreamingCallback, // File streaming callback for real-time updates
    );

    const approvePlan = createApprovePlanTool(
      config.progressCallback, // Progress callback to emit plan-approved event
    );

    const completeTask = createCompleteTaskTool();

    const webTools = config.firecrawlEnabled
      ? createWebTools({ enableSearch: true })
      : {};

    return {
      bashExecute,
      searchKnowledge,
      summarizeContext,
      proposeTestPlan,
      approvePlan,
      completeTask,
      ...webTools,
    };
  });

/**
 * Create a wrapped waitForApproval that emits an event before blocking
 * This allows the frontend to know when approval is requested
 */
const createWaitForApprovalWithEvent = (
  progressCallback?: (status: string, message: string) => void,
  waitForApproval?: (toolCallId: string) => Promise<unknown>,
) => {
  if (!waitForApproval) return undefined;

  return async (toolCallId: string): Promise<unknown> => {
    // Emit approval-requested event to frontend before blocking
    progressCallback?.(
      "tool-approval-requested",
      JSON.stringify({
        type: "tool-approval-requested",
        toolCallId,
      }),
    );

    // Block until approval is received
    return waitForApproval(toolCallId);
  };
};

/**
 * Create write tools available only in act mode
 */
const createWriteTools = (config: ToolConfig) =>
  Effect.sync(() => {
    // Self-approving registry for auto-approval
    const autoApproveRegistry = new Set<string>();
    const selfApprovingRegistry = {
      has: (id: string) => {
        autoApproveRegistry.add(id);
        return true;
      },
      add: (id: string) => autoApproveRegistry.add(id),
      delete: (id: string) => autoApproveRegistry.delete(id),
    } as Set<string>;

    // Create wrapped waitForApproval that emits events
    const waitForApprovalWithEvent = createWaitForApprovalWithEvent(
      config.progressCallback,
      config.waitForApproval,
    );

    const writeTestFile = createWriteTestFileTool(
      selfApprovingRegistry,
      config.fileStreamingCallback,
      config.diffProvider,
      false, // Don't auto-approve
      waitForApprovalWithEvent,
    );

    const writeKnowledgeFile = createWriteKnowledgeFileTool(
      config.knowledgeFileService,
    );

    const replaceInFile = createReplaceInFileTool(
      config.diffProvider,
      config.fileStreamingCallback,
      false, // Don't auto-approve
      waitForApprovalWithEvent,
    );

    return {
      writeTestFile,
      writeKnowledgeFile,
      replaceInFile,
    };
  });

/**
 * Create complete tool set based on mode
 * Plan mode: Only read-only tools + proposeTestPlan (no file writes)
 * Act mode: All tools available including file writes
 */
export const createToolSet = (config: ToolConfig) =>
  Effect.gen(function* () {
    const baseTools = yield* createBaseTools(config);

    if (config.mode === "act") {
      const writeTools = yield* createWriteTools(config);
      return { ...baseTools, ...writeTools };
    }

    return baseTools;
  });

