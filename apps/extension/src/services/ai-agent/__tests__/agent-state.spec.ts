import { describe, it } from "@effect/vitest";
import { Effect, HashMap, Ref } from "effect";
import { expect } from "vitest";
import {
  addExecution,
  createAgentState,
  createStreamingState,
  deletePlanToolCall,
  deleteStreamingArgs,
  getFilePathForPlan,
  getPlanInitStatus,
  getStreamingArgs,
  getToolCallIdForCommand,
  getToolCallIdForFile,
  hasPlanToolCall,
  hasStreamingArgs,
  incrementMistakes,
  resetMistakes,
  setMessages,
  setPlanInitStatus,
  setStreamingArgs,
  setTaskCompleted,
  setToolRejected,
  trackCommandToolCall,
  trackFileToolCall,
  trackPlanToolCall,
} from "../agent-state";

describe("Agent State", () => {
  describe("createAgentState", () => {
    it.effect("should initialize with empty state by default", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();
        const state = yield* Ref.get(stateRef);

        expect(state.messages).toEqual([]);
        expect(state.executions).toEqual([]);
        expect(state.didRejectTool).toBe(false);
        expect(state.taskCompleted).toBe(false);
        expect(state.consecutiveMistakes).toBe(0);
      }),
    );

    it.effect("should initialize with provided messages", () =>
      Effect.gen(function* () {
        const initialMessages = [
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi there" },
        ];
        const stateRef = yield* createAgentState(initialMessages);
        const state = yield* Ref.get(stateRef);

        expect(state.messages).toEqual(initialMessages);
        expect(state.messages.length).toBe(2);
      }),
    );
  });

  describe("setMessages", () => {
    it.effect("should replace all messages", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState([
          { role: "user" as const, content: "Old message" },
        ]);

        const newMessages = [
          { role: "system" as const, content: "New system message" },
        ];
        yield* setMessages(stateRef, newMessages);

        const state = yield* Ref.get(stateRef);
        expect(state.messages).toEqual(newMessages);
        expect(state.messages.length).toBe(1);
      }),
    );
  });

  describe("addExecution", () => {
    it.effect("should append an execution", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();

        yield* addExecution(stateRef, {
          testId: "test-1",
          filePath: "/path/to/test.ts",
        });
        yield* addExecution(stateRef, {
          testId: "test-2",
          filePath: "/path/to/test2.ts",
        });

        const state = yield* Ref.get(stateRef);
        expect(state.executions.length).toBe(2);
        expect(state.executions[0]).toEqual({
          testId: "test-1",
          filePath: "/path/to/test.ts",
        });
        expect(state.executions[1]).toEqual({
          testId: "test-2",
          filePath: "/path/to/test2.ts",
        });
      }),
    );
  });

  describe("setToolRejected", () => {
    it.effect("should set the rejection flag to true", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();

        yield* setToolRejected(stateRef, true);

        const state = yield* Ref.get(stateRef);
        expect(state.didRejectTool).toBe(true);
      }),
    );

    it.effect("should set the rejection flag to false", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();
        yield* setToolRejected(stateRef, true);
        yield* setToolRejected(stateRef, false);

        const state = yield* Ref.get(stateRef);
        expect(state.didRejectTool).toBe(false);
      }),
    );
  });

  describe("setTaskCompleted", () => {
    it.effect("should set task completed flag", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();

        yield* setTaskCompleted(stateRef, true);

        const state = yield* Ref.get(stateRef);
        expect(state.taskCompleted).toBe(true);
      }),
    );
  });

  describe("incrementMistakes / resetMistakes", () => {
    it.effect("should increment consecutive mistakes counter", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();

        const count1 = yield* incrementMistakes(stateRef);
        expect(count1).toBe(1);

        const count2 = yield* incrementMistakes(stateRef);
        expect(count2).toBe(2);

        const count3 = yield* incrementMistakes(stateRef);
        expect(count3).toBe(3);
      }),
    );

    it.effect("should reset mistakes counter to zero", () =>
      Effect.gen(function* () {
        const stateRef = yield* createAgentState();

        yield* incrementMistakes(stateRef);
        yield* incrementMistakes(stateRef);
        yield* incrementMistakes(stateRef);
        yield* resetMistakes(stateRef);

        const state = yield* Ref.get(stateRef);
        expect(state.consecutiveMistakes).toBe(0);
      }),
    );
  });
});

describe("Streaming State", () => {
  describe("createStreamingState", () => {
    it.effect("should initialize with empty HashMaps", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();
        const state = yield* Ref.get(stateRef);

        expect(HashMap.size(state.commandToToolCallId)).toBe(0);
        expect(HashMap.size(state.fileToToolCallId)).toBe(0);
        expect(HashMap.size(state.planToToolCallId)).toBe(0);
        expect(HashMap.size(state.streamingArgsText)).toBe(0);
        expect(HashMap.size(state.planInitializationStatus)).toBe(0);
      }),
    );
  });

  describe("Command to ToolCallId tracking", () => {
    it.effect("should track command to toolCallId mapping", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackCommandToolCall(stateRef, "echo hello", "tool-call-123");
        const toolCallId = yield* getToolCallIdForCommand(
          stateRef,
          "echo hello",
        );

        expect(toolCallId).toBe("tool-call-123");
      }),
    );

    it.effect("should return empty string for non-existent command", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const toolCallId = yield* getToolCallIdForCommand(
          stateRef,
          "non-existent",
        );

        expect(toolCallId).toBe("");
      }),
    );

    it.effect("should overwrite existing mapping", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackCommandToolCall(stateRef, "echo hello", "old-id");
        yield* trackCommandToolCall(stateRef, "echo hello", "new-id");
        const toolCallId = yield* getToolCallIdForCommand(
          stateRef,
          "echo hello",
        );

        expect(toolCallId).toBe("new-id");
      }),
    );
  });

  describe("File to ToolCallId tracking", () => {
    it.effect("should track file to toolCallId mapping", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackFileToolCall(stateRef, "/path/to/test.ts", "file-tool-456");
        const toolCallId = yield* getToolCallIdForFile(
          stateRef,
          "/path/to/test.ts",
        );

        expect(toolCallId).toBe("file-tool-456");
      }),
    );

    it.effect("should return empty string for non-existent file", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const toolCallId = yield* getToolCallIdForFile(
          stateRef,
          "/non/existent.ts",
        );

        expect(toolCallId).toBe("");
      }),
    );
  });

  describe("Plan to ToolCallId tracking", () => {
    it.effect("should track plan toolCallId to filePath mapping", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackPlanToolCall(
          stateRef,
          "plan-tool-789",
          "/plans/test-plan.md",
        );
        const filePath = yield* getFilePathForPlan(stateRef, "plan-tool-789");

        expect(filePath).toBe("/plans/test-plan.md");
      }),
    );

    it.effect("should check if plan has toolCallId", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const hasBeforeAdd = yield* hasPlanToolCall(stateRef, "plan-tool-789");
        expect(hasBeforeAdd).toBe(false);

        yield* trackPlanToolCall(
          stateRef,
          "plan-tool-789",
          "/plans/test-plan.md",
        );
        const hasAfterAdd = yield* hasPlanToolCall(stateRef, "plan-tool-789");
        expect(hasAfterAdd).toBe(true);
      }),
    );

    it.effect("should delete plan toolCallId mapping", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackPlanToolCall(
          stateRef,
          "plan-tool-789",
          "/plans/test-plan.md",
        );
        yield* deletePlanToolCall(stateRef, "plan-tool-789");

        const hasPlan = yield* hasPlanToolCall(stateRef, "plan-tool-789");
        expect(hasPlan).toBe(false);

        const filePath = yield* getFilePathForPlan(stateRef, "plan-tool-789");
        expect(filePath).toBe("");
      }),
    );
  });

  describe("Streaming args tracking", () => {
    it.effect("should set and get streaming args", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* setStreamingArgs(stateRef, "tool-123", '{"field": "value"}');
        const args = yield* getStreamingArgs(stateRef, "tool-123");

        expect(args).toBe('{"field": "value"}');
      }),
    );

    it.effect("should return empty string for non-existent args", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const args = yield* getStreamingArgs(stateRef, "non-existent");

        expect(args).toBe("");
      }),
    );

    it.effect("should check if streaming args exists", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const hasBefore = yield* hasStreamingArgs(stateRef, "tool-123");
        expect(hasBefore).toBe(false);

        yield* setStreamingArgs(stateRef, "tool-123", "content");
        const hasAfter = yield* hasStreamingArgs(stateRef, "tool-123");
        expect(hasAfter).toBe(true);
      }),
    );

    it.effect("should delete streaming args", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* setStreamingArgs(stateRef, "tool-123", "content");
        yield* deleteStreamingArgs(stateRef, "tool-123");

        const has = yield* hasStreamingArgs(stateRef, "tool-123");
        expect(has).toBe(false);

        const args = yield* getStreamingArgs(stateRef, "tool-123");
        expect(args).toBe("");
      }),
    );

    it.effect("should accumulate args by appending", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* setStreamingArgs(stateRef, "tool-123", "first");
        const args1 = yield* getStreamingArgs(stateRef, "tool-123");

        yield* setStreamingArgs(stateRef, "tool-123", `${args1}second`);
        const args2 = yield* getStreamingArgs(stateRef, "tool-123");

        expect(args2).toBe("firstsecond");
      }),
    );
  });

  describe("Plan initialization status", () => {
    it.effect("should set and get plan init status", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();
        const promise = Promise.resolve(true);

        yield* setPlanInitStatus(stateRef, "plan-123", promise);
        const status = yield* getPlanInitStatus(stateRef, "plan-123");

        expect(status).toBe(promise);
      }),
    );

    it.effect("should return null for non-existent status", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        const status = yield* getPlanInitStatus(stateRef, "non-existent");

        expect(status).toBe(null);
      }),
    );
  });

  describe("HashMap immutability", () => {
    it.effect("should maintain immutability across updates", () =>
      Effect.gen(function* () {
        const stateRef = yield* createStreamingState();

        yield* trackCommandToolCall(stateRef, "cmd1", "id1");

        yield* trackCommandToolCall(stateRef, "cmd2", "id2");
        const state = yield* Ref.get(stateRef);

        // Both commands should be tracked
        const id1 = yield* getToolCallIdForCommand(stateRef, "cmd1");
        const id2 = yield* getToolCallIdForCommand(stateRef, "cmd2");

        expect(id1).toBe("id1");
        expect(id2).toBe("id2");
        expect(HashMap.size(state.commandToToolCallId)).toBe(2);
      }),
    );
  });
});
