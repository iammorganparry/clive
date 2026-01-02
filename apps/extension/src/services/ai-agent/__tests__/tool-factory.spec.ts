import { expect, vi } from "vitest";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { createToolSet, type ToolConfig } from "../tool-factory";
import { createMockTokenBudgetService } from "../../../__tests__/mock-factories";
import type { KnowledgeFileService } from "../../knowledge-file-service";
import type { SummaryService } from "../summary-service";
import type { LanguageModel } from "ai";

// Mock dependencies
vi.mock("../tools/bash-execute", () => ({
  createBashExecuteTool: vi.fn(() => ({
    name: "bashExecute",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/search-knowledge", () => ({
  createSearchKnowledgeTool: vi.fn(() => ({
    name: "searchKnowledge",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/summarize-context", () => ({
  createSummarizeContextTool: vi.fn(() => ({
    name: "summarizeContext",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/propose-test-plan", () => ({
  createProposeTestPlanTool: vi.fn(() => ({
    name: "proposeTestPlan",
    execute: vi.fn(),
  })),
  createProposeTestPlanToolWithGuard: vi.fn(() => ({
    name: "proposeTestPlan",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/complete-task", () => ({
  createCompleteTaskTool: vi.fn(() => ({
    name: "completeTask",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/approve-plan", () => ({
  createApprovePlanTool: vi.fn(() => ({
    name: "approvePlan",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/web-tools", () => ({
  createWebTools: vi.fn(() => ({
    webSearch: { name: "webSearch", execute: vi.fn() },
  })),
}));

vi.mock("../tools/write-test-file", () => ({
  createWriteTestFileTool: vi.fn(() => ({
    name: "writeTestFile",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/write-knowledge-file", () => ({
  createWriteKnowledgeFileTool: vi.fn(() => ({
    name: "writeKnowledgeFile",
    execute: vi.fn(),
  })),
}));

vi.mock("../tools/edit-file-content", () => ({
  createEditFileContentTool: vi.fn(() => ({
    name: "editFileContent",
    execute: vi.fn(),
  })),
}));

// Mock services
const createMockKnowledgeFileService = () => ({
  search: vi.fn(() => Effect.succeed([])),
  write: vi.fn(() => Effect.void),
});

const createMockSummaryService = () => ({
  summarizeMessages: vi.fn(() => Effect.succeed("Summary")),
});

const createBaseMockConfig = (): ToolConfig => ({
  mode: "plan",
  budget: createMockTokenBudgetService(),
  firecrawlEnabled: false,
  knowledgeFileService:
    createMockKnowledgeFileService() as unknown as KnowledgeFileService,
  summaryService: createMockSummaryService() as unknown as SummaryService,
  summaryModel: {} as unknown as LanguageModel,
  getMessages: Effect.succeed([]),
  setMessages: () => Effect.void,
  getKnowledgeContext: Effect.succeed(""),
});

describe("Tool Factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createToolSet - Plan Mode", () => {
    it.effect("should return base tools in plan mode", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "plan";

        const tools = yield* createToolSet(config);

        expect(tools).toHaveProperty("bashExecute");
        expect(tools).toHaveProperty("searchKnowledge");
        expect(tools).toHaveProperty("summarizeContext");
        expect(tools).toHaveProperty("proposeTestPlan");
        expect(tools).toHaveProperty("approvePlan");
        expect(tools).toHaveProperty("completeTask");
      }),
    );

    it.effect("should NOT include write tools in plan mode", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "plan";

        const tools = yield* createToolSet(config);

        expect(tools).not.toHaveProperty("writeTestFile");
        expect(tools).not.toHaveProperty("writeKnowledgeFile");
        expect(tools).not.toHaveProperty("replaceInFile");
      }),
    );

    it.effect("should NOT include web tools when firecrawl disabled", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "plan";
        config.firecrawlEnabled = false;

        const tools = yield* createToolSet(config);

        expect(tools).not.toHaveProperty("webSearch");
      }),
    );

    it.effect("should include web tools when firecrawl enabled", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "plan";
        config.firecrawlEnabled = true;

        const tools = yield* createToolSet(config);

        expect(tools).toHaveProperty("webSearch");
      }),
    );
  });

  describe("createToolSet - Act Mode", () => {
    it.effect("should return all base tools in act mode", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "act";

        const tools = yield* createToolSet(config);

        expect(tools).toHaveProperty("bashExecute");
        expect(tools).toHaveProperty("searchKnowledge");
        expect(tools).toHaveProperty("summarizeContext");
        expect(tools).toHaveProperty("completeTask");
      }),
    );

    it.effect("should include write tools in act mode", () =>
      Effect.gen(function* () {
        const config = createBaseMockConfig();
        config.mode = "act";

        const tools = yield* createToolSet(config);

        expect(tools).toHaveProperty("writeTestFile");
        expect(tools).toHaveProperty("writeKnowledgeFile");
        expect(tools).toHaveProperty("editFileContent");
      }),
    );

    it.effect(
      "should include web tools when firecrawl enabled in act mode",
      () =>
        Effect.gen(function* () {
          const config = createBaseMockConfig();
          config.mode = "act";
          config.firecrawlEnabled = true;

          const tools = yield* createToolSet(config);

          expect(tools).toHaveProperty("webSearch");
        }),
    );
  });

  describe("Tool Configuration", () => {
    it.effect("should pass budget to bash execute tool", () =>
      Effect.gen(function* () {
        const { createBashExecuteTool } = yield* Effect.promise(
          () => import("../tools/bash-execute"),
        );
        const config = createBaseMockConfig();

        yield* createToolSet(config);

        expect(createBashExecuteTool).toHaveBeenCalledWith(
          config.budget,
          config.bashStreamingCallback,
        );
      }),
    );

    it.effect("should pass knowledge file service to search tool", () =>
      Effect.gen(function* () {
        const { createSearchKnowledgeTool } = yield* Effect.promise(
          () => import("../tools/search-knowledge"),
        );
        const config = createBaseMockConfig();

        yield* createToolSet(config);

        expect(createSearchKnowledgeTool).toHaveBeenCalledWith(
          config.knowledgeFileService,
          config.onKnowledgeRetrieved,
        );
      }),
    );

    it.effect("should pass progress callback to summarize context tool", () =>
      Effect.gen(function* () {
        const { createSummarizeContextTool } = yield* Effect.promise(
          () => import("../tools/summarize-context"),
        );
        const config = createBaseMockConfig();
        config.progressCallback = vi.fn();

        yield* createToolSet(config);

        expect(createSummarizeContextTool).toHaveBeenCalledWith(
          config.summaryService,
          config.summaryModel,
          expect.anything(),
          expect.anything(),
          config.progressCallback,
          expect.anything(),
        );
      }),
    );

    it.effect("should pass progress callback to approve plan tool", () =>
      Effect.gen(function* () {
        const { createApprovePlanTool } = yield* Effect.promise(
          () => import("../tools/approve-plan"),
        );
        const config = createBaseMockConfig();
        config.progressCallback = vi.fn();

        yield* createToolSet(config);

        expect(createApprovePlanTool).toHaveBeenCalledWith(
          config.progressCallback,
        );
      }),
    );
  });

  describe("Streaming Callbacks", () => {
    it.effect("should pass bash streaming callback to bash tool", () =>
      Effect.gen(function* () {
        const { createBashExecuteTool } = yield* Effect.promise(
          () => import("../tools/bash-execute"),
        );
        const config = createBaseMockConfig();
        const bashCallback = vi.fn();
        config.bashStreamingCallback = bashCallback;

        yield* createToolSet(config);

        expect(createBashExecuteTool).toHaveBeenCalledWith(
          expect.anything(),
          bashCallback,
        );
      }),
    );
  });

  describe("Mode Switching", () => {
    it.effect(
      "should support switching from plan to act mode with different tool sets",
      () =>
        Effect.gen(function* () {
          const planConfig = createBaseMockConfig();
          planConfig.mode = "plan";

          const actConfig = createBaseMockConfig();
          actConfig.mode = "act";

          const planTools = yield* createToolSet(planConfig);
          const actTools = yield* createToolSet(actConfig);

          // Plan mode should not have write tools
          expect(planTools).not.toHaveProperty("writeTestFile");

          // Act mode should have write tools
          expect(actTools).toHaveProperty("writeTestFile");
        }),
    );
  });
});
