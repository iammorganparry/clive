import { describe, expect, it, vi, beforeEach } from "vitest";
import { Stream, Effect, Runtime, Chunk } from "effect";
import type { ClaudeCliEvent } from "../../claude-cli-service.js";
import { streamFromCli, streamFromCliGenerator } from "../cli-stream-adapter.js";

// Mock the logger to avoid noise in tests
vi.mock("../../../utils/logger.js", () => ({
  logToOutput: vi.fn(),
}));

describe("cli-stream-adapter", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("streamFromCli - event conversions", () => {
    it("should convert text event to text-delta", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Hello world" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toContainEqual({
        type: "text-delta",
        content: "Hello world",
      });
    });

    it("should convert thinking event to thinking", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "thinking", content: "Let me think about this..." },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toContainEqual({
        type: "thinking",
        content: "Let me think about this...",
      });
    });

    it("should convert tool_use event to tool-call", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        {
          type: "tool_use",
          id: "tool-123",
          name: "readFile",
          input: { path: "/test.ts" },
        },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toContainEqual({
        type: "tool-call",
        toolCallId: "tool-123",
        toolName: "readFile",
        toolArgs: { path: "/test.ts" },
      });
    });

    it("should convert tool_result event to tool-result", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        {
          type: "tool_result",
          id: "tool-123",
          content: "File contents here",
        },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toContainEqual({
        type: "tool-result",
        toolCallId: "tool-123",
        toolResult: "File contents here",
      });
    });

    it("should convert done event to finish", async () => {
      const cliEvents: ClaudeCliEvent[] = [{ type: "done" }];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toContainEqual({
        type: "finish",
      });
    });

    it("should filter out error events (returns null)", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Before error" },
        { type: "error", message: "Something went wrong" },
        { type: "text", content: "After error" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      // Should have 2 events (both text events), error is filtered out
      expect(eventsArray).toHaveLength(2);
      expect(eventsArray).toContainEqual({
        type: "text-delta",
        content: "Before error",
      });
      expect(eventsArray).toContainEqual({
        type: "text-delta",
        content: "After error",
      });
      // Error event should not be in the output
      expect(eventsArray.some((e) => (e as { type: string }).type === "error")).toBe(
        false,
      );
    });
  });

  describe("streamFromCli - stream behavior", () => {
    it("should filter out null events from unknown types", async () => {
      // Create a stream with an unknown event type (cast to bypass type checking)
      const cliEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Valid" },
        { type: "unknown_type", data: "something" } as unknown as ClaudeCliEvent,
        { type: "done" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      // Only valid events should pass through
      expect(eventsArray).toHaveLength(2);
      expect(eventsArray).toContainEqual({
        type: "text-delta",
        content: "Valid",
      });
      expect(eventsArray).toContainEqual({ type: "finish" });
    });

    it("should convert stream of multiple CLI events to agent events", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "thinking", content: "Planning..." },
        { type: "text", content: "Here is my response" },
        {
          type: "tool_use",
          id: "t1",
          name: "writeFile",
          input: { path: "test.ts", content: "code" },
        },
        { type: "tool_result", id: "t1", content: "File written" },
        { type: "text", content: "Done!" },
        { type: "done" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      expect(eventsArray).toHaveLength(6);
      expect(eventsArray[0]).toEqual({
        type: "thinking",
        content: "Planning...",
      });
      expect(eventsArray[1]).toEqual({
        type: "text-delta",
        content: "Here is my response",
      });
      expect(eventsArray[2]).toEqual({
        type: "tool-call",
        toolCallId: "t1",
        toolName: "writeFile",
        toolArgs: { path: "test.ts", content: "code" },
      });
      expect(eventsArray[3]).toEqual({
        type: "tool-result",
        toolCallId: "t1",
        toolResult: "File written",
      });
      expect(eventsArray[4]).toEqual({
        type: "text-delta",
        content: "Done!",
      });
      expect(eventsArray[5]).toEqual({ type: "finish" });
    });

    it("should handle empty stream", async () => {
      const cliStream = Stream.fromIterable<ClaudeCliEvent>([]);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toHaveLength(0);
    });
  });

  describe("streamFromCliGenerator", () => {
    it("should convert async generator to Effect stream", async () => {
      async function* generateEvents(): AsyncGenerator<ClaudeCliEvent> {
        yield { type: "text", content: "First" };
        yield { type: "text", content: "Second" };
        yield { type: "done" };
      }

      const agentStream = streamFromCliGenerator(generateEvents());

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      expect(eventsArray).toHaveLength(3);
      expect(eventsArray[0]).toEqual({
        type: "text-delta",
        content: "First",
      });
      expect(eventsArray[1]).toEqual({
        type: "text-delta",
        content: "Second",
      });
      expect(eventsArray[2]).toEqual({ type: "finish" });
    });

    it("should handle generator errors", async () => {
      async function* generateWithError(): AsyncGenerator<ClaudeCliEvent> {
        yield { type: "text", content: "Before error" };
        throw new Error("Generator failed");
      }

      const agentStream = streamFromCliGenerator(generateWithError());

      const result = await Stream.runCollect(agentStream).pipe(
        Effect.either,
        Runtime.runPromise(runtime),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(Error);
        expect((result.left as Error).message).toContain("Generator failed");
      }
    });

    it("should handle empty generator", async () => {
      async function* emptyGenerator(): AsyncGenerator<ClaudeCliEvent> {
        // Empty generator
      }

      const agentStream = streamFromCliGenerator(emptyGenerator());

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      expect(Chunk.toReadonlyArray(events)).toHaveLength(0);
    });

    it("should handle generator with delayed yields", async () => {
      async function* delayedGenerator(): AsyncGenerator<ClaudeCliEvent> {
        yield { type: "text", content: "Immediate" };
        await new Promise((r) => setTimeout(r, 10));
        yield { type: "text", content: "Delayed" };
        yield { type: "done" };
      }

      const agentStream = streamFromCliGenerator(delayedGenerator());

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      expect(eventsArray).toHaveLength(3);
      expect(eventsArray[0]).toEqual({
        type: "text-delta",
        content: "Immediate",
      });
      expect(eventsArray[1]).toEqual({
        type: "text-delta",
        content: "Delayed",
      });
      expect(eventsArray[2]).toEqual({ type: "finish" });
    });
  });

  describe("edge cases", () => {
    it("should handle tool_use with complex input", async () => {
      const complexInput = {
        files: [
          { path: "/a.ts", content: "const a = 1;" },
          { path: "/b.ts", content: "const b = 2;" },
        ],
        options: {
          recursive: true,
          overwrite: false,
        },
      };

      const cliEvents: ClaudeCliEvent[] = [
        {
          type: "tool_use",
          id: "complex-tool",
          name: "multiFileWrite",
          input: complexInput,
        },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      expect(eventsArray[0]).toEqual({
        type: "tool-call",
        toolCallId: "complex-tool",
        toolName: "multiFileWrite",
        toolArgs: complexInput,
      });
    });

    it("should handle text events with special characters", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "text", content: "Code:\n```typescript\nconst x = 1;\n```" },
        { type: "text", content: "Unicode: 你好 🎉 \u0000" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      expect(eventsArray[0]).toEqual({
        type: "text-delta",
        content: "Code:\n```typescript\nconst x = 1;\n```",
      });
      expect(eventsArray[1]).toEqual({
        type: "text-delta",
        content: "Unicode: 你好 🎉 \u0000",
      });
    });

    it("should handle empty content in text events", async () => {
      const cliEvents: ClaudeCliEvent[] = [
        { type: "text", content: "" },
        { type: "text", content: "Non-empty" },
      ];

      const cliStream = Stream.fromIterable(cliEvents);
      const agentStream = streamFromCli(cliStream);

      const events = await Stream.runCollect(agentStream).pipe(
        Runtime.runPromise(runtime),
      );

      const eventsArray = Chunk.toReadonlyArray(events);

      // Empty content should still be converted
      expect(eventsArray).toHaveLength(2);
      expect(eventsArray[0]).toEqual({ type: "text-delta", content: "" });
      expect(eventsArray[1]).toEqual({
        type: "text-delta",
        content: "Non-empty",
      });
    });
  });
});
