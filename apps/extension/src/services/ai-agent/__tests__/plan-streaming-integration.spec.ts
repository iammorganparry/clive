import { expect, vi, beforeEach } from "vitest";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
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
import * as proposeTestPlan from "../tools/propose-test-plan";

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
      "should emit file-created event with descriptive filename when name and suites are extracted",
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
            progressCallback,
            correlationId,
          );

          // Send delta with name and suites fields for descriptive filename
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta:
                '{"name": "Authentication Tests", "suites": [{"id": "suite-1", "name": "Unit Tests", "testType": "unit", "targetFilePath": "test.ts"}, {"id": "suite-2", "name": "Integration Tests", "testType": "integration", "targetFilePath": "test.ts"}]',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify file-created event was emitted
          // Find the LAST file-created event (after rename to descriptive filename)
          const fileCreatedEvents = events.filter(
            (e) => e.status === "file-created",
          );
          expect(fileCreatedEvents.length).toBeGreaterThan(0);
          const fileCreatedEvent =
            fileCreatedEvents[fileCreatedEvents.length - 1];

          const parsed = fileCreatedEvent
            ? JSON.parse(fileCreatedEvent.message)
            : null;
          expect(parsed?.type).toBe("file-created");
          expect(parsed?.toolCallId).toBe(toolCallId);
          // Verify descriptive filename format: {name}-{testType}-{count}-suites.md
          expect(parsed?.filePath).toMatch(
            /^\.clive\/plans\/authentication-tests-(unit|integration|e2e|mixed)-2-suites\.md$/,
          );
        }),
    );

    it.effect(
      "should use fallback filename when suites info not available",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-fallback";
          const toolCallId = "propose-plan-fallback";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming for proposeTestPlan
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Send delta with only name field (suites not yet available)
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta: '{"name": "Test Plan for Auth"',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify file-created event was emitted with fallback filename
          const fileCreatedEvent = events.find(
            (e) => e.status === "file-created",
          );
          expect(fileCreatedEvent).toBeDefined();

          const parsed = fileCreatedEvent
            ? JSON.parse(fileCreatedEvent.message)
            : null;
          expect(parsed?.type).toBe("file-created");
          expect(parsed?.toolCallId).toBe(toolCallId);
          // Fallback format: {sanitized-name}.md (no timestamp when suites info not available)
          expect(parsed?.filePath).toBe(".clive/plans/test-plan-for-auth.md");
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
            progressCallback,
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
              inputTextDelta: "}",
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
            progressCallback,
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
              inputTextDelta: ", more content",
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta: ", even more content",
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
      "should create plan file path in .clive/plans/ directory with descriptive filename",
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
            progressCallback,
            correlationId,
          );

          // Send delta with name and suites for descriptive filename
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta:
                '{"name": "Directory Test Plan", "suites": [{"id": "suite-1", "name": "Unit Tests", "testType": "unit", "targetFilePath": "test.ts"}]',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify file path is in .clive/plans/ with descriptive format
          // Find the LAST file-created event (after rename to descriptive filename)
          const fileCreatedEvents = events.filter(
            (e) => e.status === "file-created",
          );
          expect(fileCreatedEvents.length).toBeGreaterThan(0);
          const fileCreatedEvent =
            fileCreatedEvents[fileCreatedEvents.length - 1];

          const parsed = fileCreatedEvent
            ? JSON.parse(fileCreatedEvent.message)
            : null;
          expect(parsed?.filePath).toMatch(
            /^\.clive\/plans\/directory-test-plan-/,
          );
          expect(parsed?.filePath).toMatch(/-unit-1-suite\.md$/);
        }),
    );

    it.effect(
      "should generate descriptive filenames for different test types and suite counts",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-filename-variants";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Test case 1: Single unit test suite
          const toolCallId1 = "propose-plan-single-unit";
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId: toolCallId1 },
            streamingState,
            progressCallback,
            correlationId,
          );
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId: toolCallId1,
              inputTextDelta:
                '{"name": "Auth Tests", "suites": [{"id": "suite-1", "name": "Unit Tests", "testType": "unit", "targetFilePath": "test.ts"}]',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Find the LAST file-created event for this toolCallId (after rename)
          const events1 = events.filter(
            (e) =>
              e.status === "file-created" &&
              JSON.parse(e.message).toolCallId === toolCallId1,
          );
          expect(events1.length).toBeGreaterThan(0);
          const event1 = events1[events1.length - 1];
          const parsed1 = event1 ? JSON.parse(event1.message) : null;
          expect(parsed1?.filePath).toBe(
            ".clive/plans/auth-tests-unit-1-suite.md",
          );

          // Test case 2: Multiple integration test suites
          const toolCallId2 = "propose-plan-multi-integration";
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId: toolCallId2 },
            streamingState,
            progressCallback,
            correlationId,
          );
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId: toolCallId2,
              inputTextDelta:
                '{"name": "API Tests", "suites": [{"id": "suite-1", "testType": "integration", "targetFilePath": "test.ts"}, {"id": "suite-2", "testType": "integration", "targetFilePath": "test.ts"}, {"id": "suite-3", "testType": "integration", "targetFilePath": "test.ts"}]',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Find the LAST file-created event for this toolCallId (after rename)
          const events2 = events.filter(
            (e) =>
              e.status === "file-created" &&
              JSON.parse(e.message).toolCallId === toolCallId2,
          );
          expect(events2.length).toBeGreaterThan(0);
          const event2 = events2[events2.length - 1];
          const parsed2 = event2 ? JSON.parse(event2.message) : null;
          expect(parsed2?.filePath).toBe(
            ".clive/plans/api-tests-integration-3-suites.md",
          );

          // Test case 3: Mixed test types (should use "mixed")
          const toolCallId3 = "propose-plan-mixed";
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId: toolCallId3 },
            streamingState,
            progressCallback,
            correlationId,
          );
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId: toolCallId3,
              inputTextDelta:
                '{"name": "Comprehensive Tests", "suites": [{"id": "suite-1", "testType": "unit", "targetFilePath": "test.ts"}, {"id": "suite-2", "testType": "integration", "targetFilePath": "test.ts"}]',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Find the LAST file-created event for this toolCallId (after rename)
          const events3 = events.filter(
            (e) =>
              e.status === "file-created" &&
              JSON.parse(e.message).toolCallId === toolCallId3,
          );
          expect(events3.length).toBeGreaterThan(0);
          const event3 = events3[events3.length - 1];
          const parsed3 = event3 ? JSON.parse(event3.message) : null;
          expect(parsed3?.filePath).toBe(
            ".clive/plans/comprehensive-tests-mixed-2-suites.md",
          );
        }),
    );

    it.effect(
      "should emit plan-content-streaming even when file initialization fails",
      () =>
        Effect.gen(function* () {
          const streamingState = yield* createStreamingState();
          const correlationId = "test-plan-failure";
          const toolCallId = "propose-plan-failure";
          const events: Array<{ status: string; message: string }> = [];
          const progressCallback = (status: string, message: string) => {
            events.push({ status, message });
          };

          // Initialize streaming
          yield* handleToolCallStreamingStart(
            { toolName: "proposeTestPlan", toolCallId },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Mock file initialization to fail
          vi.mocked(
            proposeTestPlan.initializePlanStreamingWriteEffect,
          ).mockReturnValue(
            Effect.fail(
              new proposeTestPlan.PlanStreamingError({
                message: "Failed to create file",
              }),
            ),
          );

          // Send delta with name first (will trigger failed initialization)
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta: '{"name": "Failure Test Plan"',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // Verify error event was emitted
          const errorEvent = events.find((e) => e.status === "error");
          expect(errorEvent).toBeDefined();

          // Now send delta with planContent (should still emit event despite file failure)
          yield* handleToolCallDelta(
            {
              toolName: "proposeTestPlan",
              toolCallId,
              inputTextDelta:
                ', "planContent": "# Test Plan\\n\\nContent here"}',
            },
            streamingState,
            progressCallback,
            correlationId,
          );

          // CRITICAL: Verify plan-content-streaming event was still emitted despite file failure
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
          expect(parsed?.content).toContain("Content here");
          expect(parsed?.isComplete).toBe(false);
          // filePath should still be present (tracked before initialization attempt)
          // When initialization fails, it uses the placeholder path (sanitized name)
          expect(parsed?.filePath).toBeDefined();
          expect(parsed?.filePath).toBe(".clive/plans/failure-test-plan.md");
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

          // Override mock to return the expected path
          vi.mocked(
            proposeTestPlan.finalizePlanStreamingWriteEffect,
          ).mockReturnValue(Effect.succeed(targetPath));

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
