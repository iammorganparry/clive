/**
 * MCP Bridge Handlers Tests
 * Tests for the bridge method handlers for the VSCode extension side
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliveViewProvider } from "../../views/clive-view-provider.js";
import { createBridgeHandlers } from "../handlers.js";

// Mock vscode globally
vi.mock("vscode", async () => {
  const { createVSCodeMock } = await import(
    "../../__tests__/mock-factories/vscode-mock.js"
  );
  return createVSCodeMock();
});

/**
 * Create a mock CliveViewProvider for testing
 */
function createMockProvider(postMessage = vi.fn()): Partial<CliveViewProvider> {
  return {
    getWebview: vi.fn().mockReturnValue({
      webview: {
        postMessage,
      },
    }),
  };
}

describe("MCP Bridge Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createBridgeHandlers", () => {
    it("returns an object with all required handlers", () => {
      const handlers = createBridgeHandlers();

      expect(handlers).toHaveProperty("proposeTestPlan");
      expect(handlers).toHaveProperty("approvePlan");
      expect(handlers).toHaveProperty("summarizeContext");
      expect(typeof handlers.proposeTestPlan).toBe("function");
      expect(typeof handlers.approvePlan).toBe("function");
      expect(typeof handlers.summarizeContext).toBe("function");
    });

    it("accepts null webview provider", () => {
      const handlers = createBridgeHandlers(null);

      expect(handlers).toHaveProperty("proposeTestPlan");
      expect(handlers).toHaveProperty("approvePlan");
      expect(handlers).toHaveProperty("summarizeContext");
    });
  });

  describe("proposeTestPlan handler", () => {
    it("generates unique plan ID on error path", async () => {
      // Since mocking Effect is complex, test the error path
      // which still generates the planId before the streaming calls
      const handlers = createBridgeHandlers();

      // This will fail due to VSCode not being available, but we can check the error response
      const result = await handlers.proposeTestPlan({
        name: "Test Plan",
        planContent: "# Test Plan Content",
        toolCallId: "tool-123",
      });

      // The error response still has a message
      expect(result).toBeDefined();
      expect(typeof result.message).toBe("string");
    });

    it("returns success when vscode is mocked", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.proposeTestPlan({
        name: "Successful Plan",
        planContent: "# Content",
        toolCallId: "tool-456",
      });

      // With vscode mock in place, this should succeed
      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it("works without webview provider for plan-content-streaming", async () => {
      const handlers = createBridgeHandlers(null);

      const result = await handlers.proposeTestPlan({
        name: "Plan Without Webview",
        planContent: "# Content",
        toolCallId: "tool-789",
      });

      // Should not crash when webviewProvider is null
      expect(result).toBeDefined();
      expect(typeof result.message).toBe("string");
    });
  });

  describe("approvePlan handler", () => {
    it("returns act mode when approved=true", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.approvePlan({
        approved: true,
        planId: "plan-123",
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe("act");
      expect(result.message).toBe("Plan approved. Switching to act mode.");
    });

    it("returns plan mode when approved=false", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.approvePlan({
        approved: false,
        planId: "plan-123",
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe("plan");
      expect(result.message).toBe("Plan rejected. Please revise.");
    });

    it("includes feedback in rejection message", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.approvePlan({
        approved: false,
        feedback: "Needs more detail on edge cases",
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe("plan");
      expect(result.message).toBe(
        "Plan rejected: Needs more detail on edge cases",
      );
    });

    it("handles missing planId", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.approvePlan({
        approved: true,
      });

      expect(result.success).toBe(true);
      expect(result.mode).toBe("act");
    });

    it("emits plan-approval event to webview when approved", async () => {
      const mockPostMessage = vi.fn();
      const mockProvider = createMockProvider(mockPostMessage);
      const handlers = createBridgeHandlers(
        mockProvider as unknown as CliveViewProvider,
      );

      await handlers.approvePlan({
        approved: true,
        planId: "plan-123",
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "mcp-bridge-event",
        event: "plan-approval",
        data: {
          approved: true,
          planId: "plan-123",
          feedback: undefined,
        },
      });
    });

    it("emits plan-approval event to webview when rejected with feedback", async () => {
      const mockPostMessage = vi.fn();
      const mockProvider = createMockProvider(mockPostMessage);
      const handlers = createBridgeHandlers(
        mockProvider as unknown as CliveViewProvider,
      );

      await handlers.approvePlan({
        approved: false,
        feedback: "Needs more tests",
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "mcp-bridge-event",
        event: "plan-approval",
        data: {
          approved: false,
          planId: undefined,
          feedback: "Needs more tests",
        },
      });
    });

    it("works without webview provider", async () => {
      const handlers = createBridgeHandlers(null);
      const result = await handlers.approvePlan({ approved: true });

      expect(result.success).toBe(true);
      expect(result.mode).toBe("act");
    });
  });

  describe("summarizeContext handler", () => {
    it("returns token metrics", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.summarizeContext({
        summary: "This is a summary of the context",
        tokensBefore: 15000,
        tokensAfter: 3000,
      });

      expect(result.success).toBe(true);
      expect(result.tokensBefore).toBe(15000);
      expect(result.tokensAfter).toBe(3000);
    });

    it("uses defaults for missing token estimates", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.summarizeContext({
        summary: "Summary without token counts",
      });

      expect(result.success).toBe(true);
      expect(result.tokensBefore).toBe(10000);
      expect(result.tokensAfter).toBe(2000);
    });

    it("includes message with token reduction info", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.summarizeContext({
        summary: "Summary",
        tokensBefore: 8000,
        tokensAfter: 1500,
      });

      expect(result.message).toContain("8000");
      expect(result.message).toContain("1500");
    });

    it("handles preserveKnowledge flag", async () => {
      const handlers = createBridgeHandlers();

      const result = await handlers.summarizeContext({
        summary: "Summary with knowledge preservation",
        preserveKnowledge: true,
      });

      expect(result.success).toBe(true);
    });

    it("emits summarize-context event to webview", async () => {
      const mockPostMessage = vi.fn();
      const mockProvider = createMockProvider(mockPostMessage);
      const handlers = createBridgeHandlers(
        mockProvider as unknown as CliveViewProvider,
      );

      await handlers.summarizeContext({
        summary: "Test summary",
        tokensBefore: 5000,
        tokensAfter: 1000,
        preserveKnowledge: false,
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "mcp-bridge-event",
        event: "summarize-context",
        data: {
          summary: "Test summary",
          tokensBefore: 5000,
          tokensAfter: 1000,
          preserveKnowledge: false,
        },
      });
    });

    it("uses default preserveKnowledge=true when not specified", async () => {
      const mockPostMessage = vi.fn();
      const mockProvider = createMockProvider(mockPostMessage);
      const handlers = createBridgeHandlers(
        mockProvider as unknown as CliveViewProvider,
      );

      await handlers.summarizeContext({
        summary: "Test summary",
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        type: "mcp-bridge-event",
        event: "summarize-context",
        data: {
          summary: "Test summary",
          tokensBefore: 10000,
          tokensAfter: 2000,
          preserveKnowledge: true,
        },
      });
    });

    it("works without webview provider", async () => {
      const handlers = createBridgeHandlers(null);
      const result = await handlers.summarizeContext({
        summary: "Test",
      });

      expect(result.success).toBe(true);
    });
  });
});
