/**
 * Unit Tests for buildInitialMessages function
 * Tests mode-aware behavior for plan vs act mode
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Effect } from "effect";
import { buildInitialMessages } from "../testing-agent.js";
import * as vscodeEffects from "../../../lib/vscode-effects.js";
import type * as vscode from "vscode";

// Mock vscode first (required by vscode-effects)
// Support both default import (import vscode from "vscode") and namespace import (import * as vscode from "vscode")
vi.mock("vscode", async (_importOriginal) => {
  const { createVSCodeMock } = await import(
    "../../../__tests__/mock-factories"
  );
  const mock = createVSCodeMock();
  // Return object with default export for default imports
  return {
    ...mock,
    default: mock,
  };
});

// Mock vscode-effects
vi.mock("../../../lib/vscode-effects.js", () => ({
  getWorkspaceRoot: vi.fn(),
}));

describe("buildInitialMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock return value for getWorkspaceRoot
    vi.mocked(vscodeEffects.getWorkspaceRoot).mockReturnValue(
      Effect.succeed({
        fsPath: "/test/workspace",
        scheme: "file",
      } as vscode.Uri),
    );
  });

  describe("Mode-aware behavior", () => {
    it("should append planning prompt in plan mode when history ends with assistant message", async () => {
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

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "plan"),
      );

      expect(messages.length).toBe(3);
      expect(messages[0]).toEqual(conversationHistory[0]);
      expect(messages[1]).toEqual(conversationHistory[1]);
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toContain("Analyze this file");
      expect(messages[2].content).toContain(
        "propose a comprehensive test strategy",
      );
    });

    it("should NOT append planning prompt in act mode when history ends with assistant message", async () => {
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

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "act"),
      );

      expect(messages.length).toBe(2);
      expect(messages[0]).toEqual(conversationHistory[0]);
      expect(messages[1]).toEqual(conversationHistory[1]);
      // Should NOT have planning prompt appended
      expect(
        messages.every(
          (m) => !m.content.includes("propose a comprehensive test strategy"),
        ),
      ).toBe(true);
    });

    it("should NOT append planning prompt in plan mode when history ends with user message", async () => {
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

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "plan"),
      );

      expect(messages.length).toBe(3);
      expect(messages).toEqual(conversationHistory);
      // Should NOT append planning prompt when last message is from user
    });

    it("should NOT append planning prompt in act mode when history ends with user message", async () => {
      const files = ["src/test.ts"];
      const conversationHistory = [
        {
          role: "user" as const,
          content: "Write tests for: Unit Tests",
        },
      ];

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "act"),
      );

      expect(messages.length).toBe(1);
      expect(messages).toEqual(conversationHistory);
    });

    it("should use planning prompt when conversation history is empty (regardless of mode)", async () => {
      const files = ["src/test.ts"];

      const planMessages = await Effect.runPromise(
        buildInitialMessages(files, [], "plan"),
      );
      const actMessages = await Effect.runPromise(
        buildInitialMessages(files, [], "act"),
      );

      // Both should have planning prompt when history is empty
      expect(planMessages.length).toBe(1);
      expect(actMessages.length).toBe(1);
      expect(planMessages[0].content).toContain("Analyze this file");
      expect(actMessages[0].content).toContain("Analyze this file");
    });

    it("should handle changeset prompt correctly in plan mode", async () => {
      const files = ["src/file1.ts", "src/file2.ts"];
      const conversationHistory = [
        {
          role: "assistant" as const,
          content: "Previous response",
        },
      ];

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "plan"),
      );

      expect(messages.length).toBe(2);
      expect(messages[1].content).toContain("Analyze this changeset");
      expect(messages[1].content).toContain(
        "propose ONE consolidated test plan",
      );
    });

    it("should handle changeset prompt correctly in act mode (no append)", async () => {
      const files = ["src/file1.ts", "src/file2.ts"];
      const conversationHistory = [
        {
          role: "assistant" as const,
          content: "Previous response",
        },
      ];

      const messages = await Effect.runPromise(
        buildInitialMessages(files, conversationHistory, "act"),
      );

      expect(messages.length).toBe(1);
      expect(messages[0]).toEqual(conversationHistory[0]);
    });
  });
});
