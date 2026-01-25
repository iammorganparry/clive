/**
 * Unit Tests for buildInitialMessages function
 * Tests mode-aware behavior for plan vs act mode
 */

import { it } from "@effect/vitest";
import { Effect } from "effect";
import { beforeEach, describe, expect } from "vitest";
import {
  createMockVSCodeServiceLayer,
  type createVSCodeMock,
} from "../../../__tests__/mock-factories/index.js";
import { buildInitialMessages } from "../testing-agent.js";

describe("buildInitialMessages", () => {
  let mockVSCodeServiceLayer: ReturnType<
    typeof createMockVSCodeServiceLayer
  >["layer"];
  let _mockVscode: ReturnType<typeof createVSCodeMock>;

  beforeEach(() => {
    // Create mock VSCodeService layer
    const { layer, mockVscode: vsMock } = createMockVSCodeServiceLayer();
    mockVSCodeServiceLayer = layer;
    _mockVscode = vsMock;
  });
  describe("Mode-aware behavior", () => {
    it.effect(
      "should append planning prompt in plan mode when history ends with assistant message",
      () =>
        Effect.gen(function* () {
          const files = ["src/test.ts"];
          const conversationHistory = [
            {
              role: "user" as const,
              content: "Initial request",
            },
            {
              role: "assistant" as const,
              content: "Assistant response",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "plan",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(3);
            expect(messages[0]).toEqual(conversationHistory[0]);
            expect(messages[1]).toEqual(conversationHistory[1]);
            expect(messages[2].role).toBe("user");
            expect(messages[2].content).toContain("Analyze this file");
            expect(messages[2].content).toContain(
              "propose a comprehensive test strategy",
            );
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should NOT append planning prompt in act mode when history ends with assistant message",
      () =>
        Effect.gen(function* () {
          const files = ["src/test.ts"];
          const conversationHistory = [
            {
              role: "user" as const,
              content: "Write tests for: Unit Tests",
            },
            {
              role: "assistant" as const,
              content: "I'll implement the tests",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "act",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(2);
            expect(messages[0]).toEqual(conversationHistory[0]);
            expect(messages[1]).toEqual(conversationHistory[1]);
            // Should NOT have planning prompt appended
            expect(
              messages.every(
                (m) =>
                  !m.content.includes("propose a comprehensive test strategy"),
              ),
            ).toBe(true);
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should NOT append planning prompt in plan mode when history ends with user message",
      () =>
        Effect.gen(function* () {
          const files = ["src/test.ts"];
          const conversationHistory = [
            {
              role: "user" as const,
              content: "Initial request",
            },
            {
              role: "assistant" as const,
              content: "Assistant response",
            },
            {
              role: "user" as const,
              content: "Follow-up question",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "plan",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(3);
            expect(messages).toEqual(conversationHistory);
            // Should NOT append planning prompt when last message is from user
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should NOT append planning prompt in act mode when history ends with user message",
      () =>
        Effect.gen(function* () {
          const files = ["src/test.ts"];
          const conversationHistory = [
            {
              role: "user" as const,
              content: "Write tests for: Unit Tests",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "act",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(1);
            expect(messages).toEqual(conversationHistory);
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should use planning prompt when conversation history is empty (regardless of mode)",
      () =>
        Effect.gen(function* () {
          const files = ["src/test.ts"];

          const planMessages = yield* buildInitialMessages(files, [], "plan");
          const actMessages = yield* buildInitialMessages(files, [], "act");

          yield* Effect.sync(() => {
            // Both should have planning prompt when history is empty
            expect(planMessages.length).toBe(1);
            expect(actMessages.length).toBe(1);
            expect(planMessages[0].content).toContain("Analyze this file");
            expect(actMessages[0].content).toContain("Analyze this file");
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should handle changeset prompt correctly in plan mode",
      () =>
        Effect.gen(function* () {
          const files = ["src/file1.ts", "src/file2.ts"];
          const conversationHistory = [
            {
              role: "assistant" as const,
              content: "Previous response",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "plan",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(2);
            expect(messages[1].content).toContain("Analyze this changeset");
            expect(messages[1].content).toContain(
              "propose ONE consolidated test plan",
            );
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );

    it.effect(
      "should handle changeset prompt correctly in act mode (no append)",
      () =>
        Effect.gen(function* () {
          const files = ["src/file1.ts", "src/file2.ts"];
          const conversationHistory = [
            {
              role: "assistant" as const,
              content: "Previous response",
            },
          ];

          const messages = yield* buildInitialMessages(
            files,
            conversationHistory,
            "act",
          );

          yield* Effect.sync(() => {
            expect(messages.length).toBe(1);
            expect(messages[0]).toEqual(conversationHistory[0]);
          });
        }).pipe(Effect.provide(mockVSCodeServiceLayer)) as Effect.Effect<void>,
    );
  });
});
