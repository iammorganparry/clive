/**
 * approvePlan MCP Tool Tests
 * Tests for plan approval/rejection with mode switching
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the extension bridge
vi.mock("../../bridge/extension-bridge.js", () => ({
  ensureBridgeConnected: vi.fn(),
}));

// Import after mocks
import { ensureBridgeConnected } from "../../bridge/extension-bridge.js";

// Mock MCP server
const mockTool = vi.fn();
const mockServer = {
  tool: mockTool,
};

describe("approvePlan MCP Tool", () => {
  let toolHandler: (input: {
    approved: boolean;
    planId?: string;
    feedback?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  let mockBridge: { call: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Create mock bridge with default approval response
    mockBridge = {
      call: vi.fn().mockResolvedValue({
        success: true,
        mode: "act",
        message: "Plan approved",
      }),
    };
    vi.mocked(ensureBridgeConnected).mockResolvedValue(mockBridge as never);

    // Import and register the tool
    const { registerApprovePlan } = await import("../approve-plan.js");
    registerApprovePlan(mockServer as never);

    // Capture the tool handler
    toolHandler = mockTool.mock.calls[0][3];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("tool registration", () => {
    it("registers tool with correct name and description", () => {
      expect(mockTool).toHaveBeenCalled();
      const [name, description] = mockTool.mock.calls[0];

      expect(name).toBe("approvePlan");
      expect(description).toContain("plan approval");
      expect(description).toContain("PLAN MODE");
      expect(description).toContain("ACT MODE");
    });

    it("registers with correct schema", () => {
      const schema = mockTool.mock.calls[0][2];

      expect(schema).toHaveProperty("approved");
      expect(schema).toHaveProperty("planId");
      expect(schema).toHaveProperty("feedback");
    });
  });

  describe("approval flow", () => {
    it("sends approval to bridge", async () => {
      await toolHandler({ approved: true });

      expect(mockBridge.call).toHaveBeenCalledWith("approvePlan", {
        approved: true,
      });
    });

    it("returns act mode when approved", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        mode: "act",
        message: "Plan approved, entering act mode",
      });

      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.approved).toBe(true);
      expect(parsed.mode).toBe("act");
    });

    it("includes planId in approval request", async () => {
      await toolHandler({ approved: true, planId: "plan-456" });

      expect(mockBridge.call).toHaveBeenCalledWith("approvePlan", {
        approved: true,
        planId: "plan-456",
      });
    });
  });

  describe("rejection flow", () => {
    it("sends rejection to bridge", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        mode: "plan",
        message: "Plan rejected, please revise",
      });

      await toolHandler({ approved: false });

      expect(mockBridge.call).toHaveBeenCalledWith("approvePlan", {
        approved: false,
      });
    });

    it("returns plan mode when rejected", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        mode: "plan",
        message: "Plan rejected",
      });

      const result = await toolHandler({ approved: false });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
      expect(parsed.approved).toBe(false);
      expect(parsed.mode).toBe("plan");
    });

    it("includes feedback in rejection", async () => {
      await toolHandler({
        approved: false,
        feedback: "Need more unit tests for edge cases",
      });

      expect(mockBridge.call).toHaveBeenCalledWith("approvePlan", {
        approved: false,
        feedback: "Need more unit tests for edge cases",
      });
    });

    it("includes both planId and feedback in rejection", async () => {
      await toolHandler({
        approved: false,
        planId: "plan-789",
        feedback: "Please add integration tests",
      });

      expect(mockBridge.call).toHaveBeenCalledWith("approvePlan", {
        approved: false,
        planId: "plan-789",
        feedback: "Please add integration tests",
      });
    });
  });

  describe("bridge connection", () => {
    it("connects to bridge before calling", async () => {
      await toolHandler({ approved: true });

      expect(ensureBridgeConnected).toHaveBeenCalled();
    });

    it("handles bridge connection error", async () => {
      vi.mocked(ensureBridgeConnected).mockRejectedValue(
        new Error("Connection refused"),
      );

      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.approved).toBe(false);
      expect(parsed.message).toBe("Connection refused");
    });
  });

  describe("error handling", () => {
    it("handles bridge call error", async () => {
      mockBridge.call.mockRejectedValue(new Error("Bridge timeout"));

      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.approved).toBe(false);
      expect(parsed.message).toBe("Bridge timeout");
    });

    it("handles non-Error exceptions", async () => {
      mockBridge.call.mockRejectedValue("unexpected error");

      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Failed to process plan approval");
    });

    it("handles bridge returning failure", async () => {
      mockBridge.call.mockResolvedValue({
        success: false,
        mode: "plan",
        message: "Mode switch not allowed",
      });

      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  describe("response format", () => {
    it("returns properly formatted JSON response", async () => {
      const result = await toolHandler({ approved: true });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
      expect(() => JSON.parse(result.content[0].text)).not.toThrow();
    });

    it("includes all expected fields in response", async () => {
      const result = await toolHandler({ approved: true });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("success");
      expect(parsed).toHaveProperty("approved");
      expect(parsed).toHaveProperty("mode");
      expect(parsed).toHaveProperty("message");
    });
  });
});
