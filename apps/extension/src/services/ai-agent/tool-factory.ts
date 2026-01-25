/**
 * Tool Factory Module
 * Provides declarative tool configuration for the testing agent
 * Handles mode-based tool selection and callback wiring
 */

import type { LanguageModel, ToolSet } from "ai";
import { Effect, type Ref } from "effect";
import type { KnowledgeFileService } from "../knowledge-file-service.js";
import type { Message } from "./context-tracker.js";
import type { LoopState } from "./loop-state.js";
import type { SummaryService } from "./summary-service.js";
import type { TokenBudget } from "./token-budget.js";
import {
  createApprovePlanTool,
  createBashExecuteTool,
  createCompleteTaskTool,
  createEditFileContentTool,
  createProposeTestPlanToolWithGuard,
  createSearchKnowledgeTool,
  createSummarizeContextTool,
  createTodoWriteTool,
  createWebTools,
  createWriteKnowledgeFileTool,
  createWriteTestFileTool,
} from "./tools/index.js";

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
  knowledgeFileService: KnowledgeFileService;
  summaryService: SummaryService;
  summaryModel: LanguageModel;
  getMessages: Effect.Effect<Message[]>;
  setMessages: (messages: Message[]) => Effect.Effect<void>;
  getKnowledgeContext: Effect.Effect<string>;
  progressCallback?: (status: string, message: string) => void;
  bashStreamingCallback?: BashStreamingCallback;
  fileStreamingCallback?: FileStreamingCallback;
  onKnowledgeRetrieved?: KnowledgeRetrievedCallback;
  waitForApproval?: (toolCallId: string) => Promise<unknown>;
  getApprovalSetting?: () => Effect.Effect<"always" | "auto">;
  signal?: AbortSignal;
  /** Loop state ref for Ralph Wiggum loop (enables TodoWrite tool) */
  loopStateRef?: Ref.Ref<LoopState>;
}

/**
 * Create base tools available in both plan and act modes
 */
const createBaseTools = (config: ToolConfig) =>
  Effect.sync(() => {
    const bashExecute = createBashExecuteTool(
      config.budget,
      config.bashStreamingCallback,
      undefined, // spawnFn - use default
      config.waitForApproval,
      config.getApprovalSetting,
      config.signal,
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

    const completeTask = createCompleteTaskTool();

    // TodoWrite tool for Ralph Wiggum loop (only when loopStateRef provided)
    const todoWrite = config.loopStateRef
      ? createTodoWriteTool(config.loopStateRef, config.progressCallback)
      : null;

    const webTools = config.firecrawlEnabled
      ? createWebTools({ enableSearch: true })
      : {};

    const tools = {
      bashExecute,
      searchKnowledge,
      summarizeContext,
      completeTask,
      ...(todoWrite && { todoWrite }),
      ...webTools,
    } as ToolSet;

    // Only include proposeTestPlan and approvePlan in plan mode
    // In act mode, the agent should only execute tests, not propose new plans
    if (config.mode === "plan") {
      // Track whether proposeTestPlan has been called to prevent duplicates
      const proposeTestPlanCalled = { value: false };

      tools.proposeTestPlan = createProposeTestPlanToolWithGuard(
        config.fileStreamingCallback,
        proposeTestPlanCalled,
      );

      tools.approvePlan = createApprovePlanTool(config.progressCallback);
    }

    return tools;
  });

/**
 * Create write tools available only in act mode
 * File edits are written directly and registered with PendingEditService
 * User can accept/reject via CodeLens in the editor (non-blocking)
 */
const createWriteTools = (config: ToolConfig) =>
  Effect.sync(() => {
    // Self-approving registry for auto-approval of proposalIds
    const autoApproveRegistry = new Set<string>();
    const selfApprovingRegistry = {
      has: (id: string) => {
        autoApproveRegistry.add(id);
        return true;
      },
      add: (id: string) => autoApproveRegistry.add(id),
      delete: (id: string) => autoApproveRegistry.delete(id),
    } as Set<string>;

    const writeTestFile = createWriteTestFileTool(
      selfApprovingRegistry,
      config.fileStreamingCallback,
    );

    const writeKnowledgeFile = createWriteKnowledgeFileTool(
      config.knowledgeFileService,
    );

    const editFileContent = createEditFileContentTool(
      config.fileStreamingCallback,
    );

    return {
      writeTestFile,
      writeKnowledgeFile,
      editFileContent,
    } as ToolSet;
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
