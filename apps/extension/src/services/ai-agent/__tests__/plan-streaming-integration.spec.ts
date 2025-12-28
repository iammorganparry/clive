import { expect, vi, beforeEach } from "vitest";
import { describe, it } from "@effect/vitest";
import { Effect, } from "effect";
import {
  handleToolCallStreamingStart,
  handleToolCallDelta,
  handleToolResult,
} from "../event-handlers";
import {
  createAgentState,
  createStreamingState,
  setStreamingArgs,
  trackPlanToolCall,
  setPlanInitStatus,
} from "../agent-state";

// Mock the plan streaming tools
vi.mock("../tools/propose-test-plan", async () => {
  const { createMockPlanStreaming } = await import(
    "../../../__tests__/mock-factories"
  );
  return createMockPlanStreaming();
});

// Mock vscode module
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../../__tests__/mock-factories"
  );
  return createVSCodeMock();
});

describe("Plan Streaming Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleProposeTestPlanDelta", () => {
    it.effect(
      "should emit file-created event when plan name is extracted",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-123";
          const toolCallId = "propose-plan-abc";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming for proposeTestPlan
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            correlationId,
          );

          // Send delta with name field
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              argsTextDelta: '{"name": "Test Plan for Auth"',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify file-created event was emitted
          const fileCreatedEvent = events.find(
            (e) => e.status === "file-created",
          );
          expect(fileCreatedEvent).toBeDefined();

          const parsed = fileCreatedEvent
            ? JSON.parse(fileCreatedEvent.message)
            : null;
          expect(parsed?.type).toBe("file-created");
          expect(parsed?.toolCallId).toBe(toolCallId);
          expect(parsed?.filePath).toContain(".clive/plans/test-plan-");
          expect(parsed?.filePath).toContain("test-plan-for-auth");
        }),
    );

    it.effect(
      "should emit plan-content-streaming events as content accumulates",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-456";
          const toolCallId = "propose-plan-def";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            correlationId,
          );

          // Pre-setup: simulate plan file already initialized
          const targetPath = ".clive/plans/test-plan-auth-123.md";
          yield* trackPlanToolCall(streamingState, toolCallId, targetPath);
          yield* setPlanInitStatus(
            streamingState,
            toolCallId,
            Promise.resolve(true),
          );

          // Set accumulated args with name already present
          yield* setStreamingArgs(
            streamingState,
            toolCallId,
            '{"name": "Test Plan", "planContent": "# Test Plan\\n\\nThis is the content"',
          );

          // Send delta with planContent
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              argsTextDelta: "}",
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify plan-content-streaming event was emitted
          const streamingEvent = events.find(
            (e) => e.status === "plan-content-streaming",
          );
          expect(streamingEvent).toBeDefined();

          const parsed = streamingEvent
            ? JSON.parse(streamingEvent.message)
            : null;
          expect(parsed?.type).toBe("plan-content-streaming");
          expect(parsed?.toolCallId).toBe(toolCallId);
          expect(parsed?.content).toContain("# Test Plan");
          expect(parsed?.isComplete).toBe(false);
          expect(parsed?.filePath).toBe(targetPath);
        }),
    );

    it.effect(
      "should include filePath in all plan-content-streaming events",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-789";
          const toolCallId = "propose-plan-ghi";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            correlationId,
          );

          // Pre-setup: simulate plan file already initialized
          const targetPath = ".clive/plans/test-plan-filepath-test.md";
          yield* trackPlanToolCall(streamingState, toolCallId, targetPath);
          yield* setPlanInitStatus(
            streamingState,
            toolCallId,
            Promise.resolve(true),
          );

          // Set accumulated args
          yield* setStreamingArgs(
            streamingState,
            toolCallId,
            '{"name": "Filepath Test", "planContent": "Content chunk 1"',
          );

          // Send multiple deltas
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              argsTextDelta: ", more content",
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              argsTextDelta: ", even more content",
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // All plan-content-streaming events should have filePath
          const streamingEvents = events.filter(
            (e) => e.status === "plan-content-streaming",
          );

          for (const event of streamingEvents) {
            const parsed = JSON.parse(event.message);
            expect(parsed.filePath).toBe(targetPath);
          }
        }),
    );

    it.effect(
      "should create plan file path in .clive/plans/ directory",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-dir";
          const toolCallId = "propose-plan-dir";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            correlationId,
          );

          // Send delta with name
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              argsTextDelta: '{"name": "Directory Test Plan"',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify file path is in .clive/plans/
          const fileCreatedEvent = events.find(
            (e) => e.status === "file-created",
          );
          expect(fileCreatedEvent).toBeDefined();

          const parsed = fileCreatedEvent
            ? JSON.parse(fileCreatedEvent.message)
            : null;
          expect(parsed?.filePath).toMatch(/^\.clive\/plans\/test-plan-/);
          expect(parsed?.filePath).toMatch(/\.md$/);
        }),
    );
  });

  describe("handleToolResult for proposeTestPlan", () => {
    it.effect(
      "should emit plan-content-streaming with isComplete=true on tool result",
      () =>
        Effect.gen(function* () {
          const agentState = yield* createAgentState();
          const streamingState = yield* createStreamingState();
          const correlationId = "test-result-123";
          const toolCallId = "propose-plan-result";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Pre-setup: simulate streaming was active
          const targetPath = ".clive/plans/test-plan-result.md";
          yield* setStreamingArgs(
            streamingState,
            toolCallId,
            '{"name": "Result Test", "planContent": "# Final Plan Content\\n\\nThis is complete."}',
          );
          yield* trackPlanToolCall(streamingState, toolCallId, targetPath);

          // Handle tool result
          yield* handleToolResult(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              toolResult: {
                output: {
                  success: true,
                  planId: "plan-123",
                  name: "Result Test",
                  message: "Plan created",
                },
              },
            },
            agentState,
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify plan-content-streaming with isComplete=true was emitted
          const completeEvent = events.find(
            (e) =>
              e.status === "plan-content-streaming" &&
              JSON.parse(e.message).isComplete === true,
          );
          expect(completeEvent).toBeDefined();

          const parsed = completeEvent
            ? JSON.parse(completeEvent.message)
            : null;
          expect(parsed?.type).toBe("plan-content-streaming");
          expect(parsed?.isComplete).toBe(true);
          expect(parsed?.content).toContain("# Final Plan Content");
          expect(parsed?.filePath).toBe(targetPath);
        }),
    );

    it.effect("should emit tool-result event for proposeTestPlan", () =>
      Effect.gen(function* () {
        const agentState = yield* createAgentState();
        const streamingState = yield* createStreamingState();
        const correlationId = "test-tool-result";
        const toolCallId = "propose-plan-tool-result";
        const events: Array<{ status: string; message: string }> = [];
        const progressCallback = (status: string, message: string) => {
          events.push({ status, message });
        };

        // Handle tool result
        yield* handleToolResult(
          {
            toolName: "proposeTestPlan",
            toolCallId,
            toolResult: {
              output: {
                success: true,
                planId: "plan-456",
                name: "Tool Result Test",
                message: "Plan created successfully",
              },
            },
          },
          agentState,
          streamingState,
          progressCallback,
          correlationId,
        );

        // Verify tool-result event was emitted
        const toolResultEvent = events.find((e) => e.status === "tool-result");
        expect(toolResultEvent).toBeDefined();

        const parsed = toolResultEvent
          ? JSON.parse(toolResultEvent.message)
          : null;
        expect(parsed?.toolName).toBe("proposeTestPlan");
        expect(parsed?.toolCallId).toBe(toolCallId);
        expect(parsed?.state).toBe("output-available");
      }),
    );
  });
});

