/**
 * summarizeContext MCP Tool Tests
 * Tests for context summarization and token management
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

describe("summarizeContext MCP Tool", () => {
  let toolHandler: (input: {
    summary: string;
    tokensBefore?: number;
    tokensAfter?: number;
    preserveKnowledge?: boolean;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  let mockBridge: { call: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Create mock bridge with default response
    mockBridge = {
      call: vi.fn().mockResolvedValue({
        success: true,
        tokensBefore: 10000,
        tokensAfter: 2000,
        message: "Context summarized successfully",
      }),
    };
    vi.mocked(ensureBridgeConnected).mockResolvedValue(mockBridge as never);

    // Import and register the tool
    const { registerSummarizeContext } = await import(
      "../summarize-context.js"
    );
    registerSummarizeContext(mockServer as never);

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

      expect(name).toBe("summarizeContext");
      expect(description).toContain("Summarize");
      expect(description).toContain("token");
    });

    it("registers with correct schema", () => {
      const schema = mockTool.mock.calls[0][2];

      expect(schema).toHaveProperty("summary");
      expect(schema).toHaveProperty("tokensBefore");
      expect(schema).toHaveProperty("tokensAfter");
      expect(schema).toHaveProperty("preserveKnowledge");
    });
  });

  describe("summary submission", () => {
    it("sends summary to bridge", async () => {
      const summary = "Key decisions: Used factory pattern for mocks.";
      await toolHandler({ summary });

      expect(mockBridge.call).toHaveBeenCalledWith(
        "summarizeContext",
        expect.objectContaining({ summary }),
      );
    });

    it("includes token estimates when provided", async () => {
      await toolHandler({
        summary: "Context summary",
        tokensBefore: 15000,
        tokensAfter: 3000,
      });

      expect(mockBridge.call).toHaveBeenCalledWith("summarizeContext", {
        summary: "Context summary",
        tokensBefore: 15000,
        tokensAfter: 3000,
      });
    });

    it("handles preserveKnowledge flag", async () => {
      await toolHandler({
        summary: "Summary with knowledge",
        preserveKnowledge: false,
      });

      expect(mockBridge.call).toHaveBeenCalledWith(
        "summarizeContext",
        expect.objectContaining({ preserveKnowledge: false }),
      );
    });
  });

  describe("token calculation", () => {
    it("returns tokensSaved in response", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        tokensBefore: 10000,
        tokensAfter: 2000,
        message: "Context summarized",
      });

      const result = await toolHandler({ summary: "Test summary" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tokensSaved).toBe(8000);
    });

    it("handles zero tokens saved", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        tokensBefore: 1000,
        tokensAfter: 1000,
        message: "No reduction",
      });

      const result = await toolHandler({ summary: "Test summary" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tokensSaved).toBe(0);
    });

    it("returns token metrics from bridge", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        tokensBefore: 25000,
        tokensAfter: 5000,
        message: "Significant reduction",
      });

      const result = await toolHandler({
        summary: "Long conversation summary",
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.tokensBefore).toBe(25000);
      expect(parsed.tokensAfter).toBe(5000);
      expect(parsed.tokensSaved).toBe(20000);
    });
  });

  describe("success response", () => {
    it("returns properly formatted response", async () => {
      const result = await toolHandler({ summary: "Test" });

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe("text");
    });

    it("includes all expected fields", async () => {
      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toHaveProperty("success");
      expect(parsed).toHaveProperty("tokensBefore");
      expect(parsed).toHaveProperty("tokensAfter");
      expect(parsed).toHaveProperty("tokensSaved");
      expect(parsed).toHaveProperty("message");
    });

    it("includes success message from bridge", async () => {
      mockBridge.call.mockResolvedValue({
        success: true,
        tokensBefore: 10000,
        tokensAfter: 2000,
        message: "Reduced from ~10000 to ~2000 tokens",
      });

      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.message).toContain("10000");
      expect(parsed.message).toContain("2000");
    });
  });

  describe("bridge connection", () => {
    it("connects to bridge before calling", async () => {
      await toolHandler({ summary: "Test" });

      expect(ensureBridgeConnected).toHaveBeenCalled();
    });

    it("handles bridge connection error", async () => {
      vi.mocked(ensureBridgeConnected).mockRejectedValue(
        new Error("Socket closed"),
      );

      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Socket closed");
    });
  });

  describe("error handling", () => {
    it("handles bridge call error", async () => {
      mockBridge.call.mockRejectedValue(new Error("Summarization failed"));

      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Summarization failed");
    });

    it("handles non-Error exceptions", async () => {
      mockBridge.call.mockRejectedValue("unexpected failure");

      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.message).toBe("Failed to summarize context");
    });

    it("handles bridge returning failure", async () => {
      mockBridge.call.mockResolvedValue({
        success: false,
        tokensBefore: 0,
        tokensAfter: 0,
        message: "Cannot summarize empty context",
      });

      const result = await toolHandler({ summary: "Test" });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles empty summary", async () => {
      await toolHandler({ summary: "" });

      expect(mockBridge.call).toHaveBeenCalledWith(
        "summarizeContext",
        expect.objectContaining({ summary: "" }),
      );
    });

    it("handles very long summary", async () => {
      const longSummary = "x".repeat(10000);
      const result = await toolHandler({ summary: longSummary });

      expect(mockBridge.call).toHaveBeenCalledWith(
        "summarizeContext",
        expect.objectContaining({ summary: longSummary }),
      );
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });

    it("handles all optional fields provided", async () => {
      const result = await toolHandler({
        summary: "Full summary with all options",
        tokensBefore: 50000,
        tokensAfter: 10000,
        preserveKnowledge: true,
      });

      expect(mockBridge.call).toHaveBeenCalledWith("summarizeContext", {
        summary: "Full summary with all options",
        tokensBefore: 50000,
        tokensAfter: 10000,
        preserveKnowledge: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.success).toBe(true);
    });
  });
});
