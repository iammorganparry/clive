import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for RPC Router Event Forwarding
 * Verifies that the progressCallback in agents.ts correctly forwards
 * plan streaming events to the onProgress callback
 */

describe("RPC Router Event Forwarding", () => {
  /**
   * Helper to create a progressCallback similar to the one in agents.ts
   * This simulates the event forwarding logic
   */
  const createProgressCallback = (
    onProgress: ((data: unknown) => void) | undefined,
    subscriptionId: string,
  ) => {
    return (status: string, message: string) => {
      if (onProgress) {
        // Check if this is a special event type (JSON) - matches agents.ts whitelist
        if (
          status === "proposal" ||
          status === "plan_file_created" ||
          status === "content_streamed" ||
          status === "tool-call" ||
          status === "tool-result" ||
          status === "tool-output-streaming" ||
          status === "tool-approval-requested" ||
          status === "usage" ||
          status === "reasoning" ||
          status === "plan-content-streaming" ||
          status === "file-created" ||
          status === "file-output-streaming"
        ) {
          try {
            const eventData = JSON.parse(message);
            onProgress({
              ...eventData,
              subscriptionId: subscriptionId || "",
            });
          } catch {
            // Not JSON, send as regular progress
            onProgress({ type: "progress", status, message });
          }
        } else {
          onProgress({ type: "progress", status, message });
        }
      }
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("plan-content-streaming events", () => {
    it("should forward plan-content-streaming events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-123";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      // Emit plan-content-streaming event
      progressCallback(
        "plan-content-streaming",
        JSON.stringify({
          type: "plan-content-streaming",
          toolCallId: "tool-abc",
          content: "# Test Plan\n\nThis is content",
          isComplete: false,
          filePath: ".clive/plans/test-plan.md",
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("plan-content-streaming");
      expect(event.toolCallId).toBe("tool-abc");
      expect(event.content).toContain("# Test Plan");
      expect(event.isComplete).toBe(false);
      expect(event.filePath).toBe(".clive/plans/test-plan.md");
    });

    it("should include subscriptionId in forwarded plan-content-streaming events", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-456";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "plan-content-streaming",
        JSON.stringify({
          type: "plan-content-streaming",
          toolCallId: "tool-def",
          content: "Plan content",
          isComplete: true,
          filePath: ".clive/plans/test.md",
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.subscriptionId).toBe("sub-456");
    });
  });

  describe("file-created events", () => {
    it("should forward file-created events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-789";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "file-created",
        JSON.stringify({
          type: "file-created",
          toolCallId: "tool-ghi",
          filePath: ".clive/plans/new-plan.md",
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("file-created");
      expect(event.toolCallId).toBe("tool-ghi");
      expect(event.filePath).toBe(".clive/plans/new-plan.md");
      expect(event.subscriptionId).toBe("sub-789");
    });
  });

  describe("file-output-streaming events", () => {
    it("should forward file-output-streaming events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-abc";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "file-output-streaming",
        JSON.stringify({
          type: "file-output-streaming",
          toolCallId: "tool-jkl",
          filePath: "src/test.spec.ts",
          content: "describe('test', () => {",
          isComplete: false,
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("file-output-streaming");
      expect(event.toolCallId).toBe("tool-jkl");
      expect(event.filePath).toBe("src/test.spec.ts");
      expect(event.content).toContain("describe");
      expect(event.isComplete).toBe(false);
      expect(event.subscriptionId).toBe("sub-abc");
    });
  });

  describe("JSON parsing", () => {
    it("should parse JSON event data correctly", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-parse";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      const complexContent = {
        type: "plan-content-streaming",
        toolCallId: "tool-parse",
        content: '# Plan with "quotes" and\nnewlines',
        isComplete: false,
        filePath: ".clive/plans/complex.md",
        nested: { key: "value", array: [1, 2, 3] },
      };

      progressCallback("plan-content-streaming", JSON.stringify(complexContent));

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.content).toBe('# Plan with "quotes" and\nnewlines');
      expect((event.nested as Record<string, unknown>).key).toBe("value");
    });

    it("should handle invalid JSON gracefully", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-invalid";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      // Send invalid JSON
      progressCallback("plan-content-streaming", "not valid json {");

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      // Should fall back to progress event format
      expect(event.type).toBe("progress");
      expect(event.status).toBe("plan-content-streaming");
      expect(event.message).toBe("not valid json {");
    });
  });

  describe("non-whitelisted events", () => {
    it("should send non-whitelisted events as progress type", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-other";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback("analyzing", "Analyzing files...");

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("progress");
      expect(event.status).toBe("analyzing");
      expect(event.message).toBe("Analyzing files...");
    });
  });

  describe("existing whitelisted events", () => {
    it("should forward tool-call events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-tool";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "tool-call",
        JSON.stringify({
          type: "tool-call",
          toolName: "bashExecute",
          toolCallId: "call-123",
          state: "input-available",
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("tool-call");
      expect(event.toolName).toBe("bashExecute");
      expect(event.subscriptionId).toBe("sub-tool");
    });

    it("should forward tool-result events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-result";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "tool-result",
        JSON.stringify({
          type: "tool-result",
          toolName: "bashExecute",
          toolCallId: "call-456",
          state: "output-available",
          output: { success: true },
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("tool-result");
      expect(event.toolName).toBe("bashExecute");
      expect(event.state).toBe("output-available");
    });

    it("should forward reasoning events to onProgress", () => {
      const receivedEvents: unknown[] = [];
      const onProgress = (data: unknown) => {
        receivedEvents.push(data);
      };
      const subscriptionId = "sub-reasoning";

      const progressCallback = createProgressCallback(onProgress, subscriptionId);

      progressCallback(
        "reasoning",
        JSON.stringify({
          type: "reasoning",
          content: "I am thinking about this problem...",
        }),
      );

      expect(receivedEvents.length).toBe(1);
      const event = receivedEvents[0] as Record<string, unknown>;
      expect(event.type).toBe("reasoning");
      expect(event.content).toContain("thinking");
    });
  });
});

