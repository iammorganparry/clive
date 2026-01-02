import { describe, expect, vi, beforeEach } from "vitest";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import type { LanguageModel } from "ai";
import { createSummarizeContextTool } from "../summarize-context";
import type { SummaryService } from "../../summary-service";
import type { Message } from "../../context-tracker";
import * as contextTracker from "../../context-tracker";
import { executeTool } from "./test-helpers";
import { createMockSummaryService } from "../../../../__tests__/mock-factories";

type SummarizeResult = {
  success: boolean;
  summary?: string;
  messagesSummarized?: number;
  tokensFreed?: number;
  error?: string;
};

describe("summarizeContextTool", () => {
  let mockSummaryService: SummaryService;
  let mockModel: LanguageModel;
  let mockGetMessages: Effect.Effect<Message[]>;
  let mockUpdateMessages: (messages: Message[]) => Effect.Effect<void>;
  let progressCallback: ((status: string, message: string) => void) | undefined;
  let updatedMessages: Message[] | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    updatedMessages = undefined;
    progressCallback = undefined;

    // Mock SummaryService
    mockSummaryService = createMockSummaryService();

    // Mock LanguageModel
    mockModel = {
      generateText: vi.fn(),
    } as unknown as LanguageModel;

    // Mock getMessages Effect
    mockGetMessages = Effect.succeed([
      { role: "user", content: "Message 1" },
      { role: "assistant", content: "Response 1" },
      { role: "user", content: "Message 2" },
      { role: "assistant", content: "Response 2" },
      { role: "user", content: "Message 3" },
      { role: "assistant", content: "Response 3" },
      { role: "user", content: "Message 4" },
      { role: "assistant", content: "Response 4" },
      { role: "user", content: "Message 5" },
      { role: "assistant", content: "Response 5" },
    ] as Message[]);

    // Mock updateMessages function
    mockUpdateMessages = (messages: Message[]) => {
      updatedMessages = messages;
      return Effect.void;
    };
  });

  describe("Success Cases", () => {
    it.effect("should summarize messages successfully", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
          ),
        );

        const result = yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(result.summary).toBe("Summary of messages");
          expect(result.messagesSummarized).toBeGreaterThan(0);
          expect(result.tokensFreed).toBeDefined();
          expect(mockSummaryService.summarizeMessages).toHaveBeenCalled();
          expect(updatedMessages).toBeDefined();
        });
      }),
    );

    it.effect("should call progress callback", () =>
      Effect.gen(function* () {
        const progressCalls: Array<[string, string]> = [];
        yield* Effect.sync(() => {
          progressCallback = (status, message) => {
            progressCalls.push([status, message]);
          };
        });

        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
            progressCallback,
          ),
        );

        yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(progressCalls.length).toBeGreaterThan(0);
          expect(
            progressCalls.some(([status]) => status === "summarizing"),
          ).toBe(true);
          expect(
            progressCalls.some(([status]) => status === "summarized"),
          ).toBe(true);
        });
      }),
    );

    it.effect("should use focus parameter when provided", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
          ),
        );

        yield* Effect.promise(() =>
          executeTool(tool, { focus: "test strategies" }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(mockSummaryService.summarizeMessages).toHaveBeenCalledWith(
            expect.any(Array),
            mockModel,
            "test strategies",
            undefined,
          );
        });
      }),
    );

    it.effect("should use persistent context when provided", () =>
      Effect.gen(function* () {
        const mockGetPersistentContext = Effect.succeed(
          "Persistent knowledge context",
        );

        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
            undefined,
            mockGetPersistentContext,
          ),
        );

        yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(mockSummaryService.summarizeMessages).toHaveBeenCalledWith(
            expect.any(Array),
            mockModel,
            undefined,
            "Persistent knowledge context",
          );
        });
      }),
    );
  });

  describe("Validation", () => {
    it.effect("should reject when not enough messages", () =>
      Effect.gen(function* () {
        // Use spyOn to mock getMessagesToKeep only for this test
        const getMessagesToKeepSpy = yield* Effect.sync(() => {
          const spy = vi.spyOn(contextTracker, "getMessagesToKeep");
          spy.mockReturnValue(100); // More than our test messages (10)
          return spy;
        });

        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
          ),
        );

        const result = yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(result.error).toContain("Not enough messages");
          expect(mockSummaryService.summarizeMessages).not.toHaveBeenCalled();
          // Restore the spy
          getMessagesToKeepSpy.mockRestore();
        });
      }),
    );
  });

  describe("Error Handling", () => {
    it.effect("should handle summary service errors", () =>
      Effect.gen(function* () {
        const errorSummaryService = yield* Effect.sync(
          () =>
            ({
              summarizeMessages: vi.fn(() =>
                Effect.fail(new Error("Summary service failed")),
              ),
            }) as unknown as SummaryService,
        );

        const errorProgressCalls: Array<[string, string]> = [];
        yield* Effect.sync(() => {
          progressCallback = (status, message) => {
            errorProgressCalls.push([status, message]);
          };
        });

        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            errorSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
            progressCallback,
          ),
        );

        const result = yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(false);
          expect(result.error).toContain("Summary service failed");
          expect(
            errorProgressCalls.some(([status]) => status === "summarize_error"),
          ).toBe(true);
        });
      }),
    );

    it.effect("should handle persistent context errors gracefully", () =>
      Effect.gen(function* () {
        const mockGetPersistentContextError = Effect.fail(
          new Error("Context error"),
        ) as unknown as Effect.Effect<string>;

        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
            undefined,
            mockGetPersistentContextError,
          ),
        );

        // Should still succeed, just without persistent context
        const result = yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(result.success).toBe(true);
          expect(mockSummaryService.summarizeMessages).toHaveBeenCalledWith(
            expect.any(Array),
            mockModel,
            undefined,
            "", // On error, catchAll returns empty string, not undefined
          );
        });
      }),
    );
  });

  describe("Message Updates", () => {
    it.effect("should update messages with summary and recent messages", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
          ),
        );

        yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(updatedMessages).toBeDefined();
          expect(updatedMessages?.length).toBeGreaterThan(0);
          // First message should be the summary
          expect(updatedMessages?.[0].role).toBe("system");
          expect(updatedMessages?.[0].content).toContain(
            "Previous conversation summary",
          );
        });
      }),
    );
  });

  describe("Token Calculation", () => {
    it.effect("should calculate tokens freed correctly", () =>
      Effect.gen(function* () {
        const tool = yield* Effect.sync(() =>
          createSummarizeContextTool(
            mockSummaryService,
            mockModel,
            mockGetMessages,
            mockUpdateMessages,
          ),
        );

        const result = yield* Effect.promise(() =>
          executeTool(tool, { focus: undefined }, {
            success: false,
          } as SummarizeResult),
        );

        yield* Effect.sync(() => {
          expect(result.tokensFreed).toBeDefined();
          expect(typeof result.tokensFreed).toBe("number");
          // Summary should be shorter than original messages
          expect(result.tokensFreed).toBeGreaterThan(0);
        });
      }),
    );
  });
});
