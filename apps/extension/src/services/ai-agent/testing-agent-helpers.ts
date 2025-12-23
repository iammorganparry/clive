import { Data, Effect, Match, Stream } from "effect";
import type { AgentStreamEvent } from "../../utils/stream-utils.js";
import type {
  ProposeTestInput,
  ProposeTestOutput,
  WriteTestFileOutput,
} from "./types.js";

// ============================================================
// Error Types
// ============================================================

export class TestingAgentError extends Data.TaggedError("TestingAgentError")<{
  message: string;
  cause?: unknown;
}> {}

export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}

// ============================================================
// Progress Callback Types
// ============================================================

export type ProgressStatus =
  | "analyzing"
  | "searching"
  | "reading"
  | "scanning"
  | "executing"
  | "proposing"
  | "writing"
  | "generating_content"
  | "proposal"
  | "plan_file_created"
  | "content_streamed";

export type ProgressCallback = (
  status: ProgressStatus,
  message: string,
) => void;

// ============================================================
// Type-Safe Tool Result Interfaces
// ============================================================

/**
 * Typed interface for proposeTest tool results from AI SDK
 * Matches the structure returned by streamText steps
 */
export interface ProposeTestToolResult {
  toolName: "proposeTest";
  toolCallId: string;
  input: ProposeTestInput;
  output: ProposeTestOutput;
}

/**
 * Typed interface for writeTestFile tool results from AI SDK
 */
export interface WriteTestFileToolResult {
  toolName: "writeTestFile";
  toolCallId: string;
  input: unknown;
  output: WriteTestFileOutput;
}

/**
 * Typed interface for proposeTest tool calls from AI SDK
 */
export interface ProposeTestToolCall {
  toolName: "proposeTest";
  toolCallId: string;
  input: ProposeTestInput;
}

/**
 * Typed interface for writeTestFile tool calls from AI SDK
 */
export interface WriteTestFileToolCall {
  toolName: "writeTestFile";
  toolCallId: string;
  input: unknown;
}

// ============================================================
// Type Guards for Tool Results
// ============================================================

export const isProposeTestResult = (
  result: unknown,
): result is ProposeTestToolResult => {
  if (typeof result !== "object" || result === null) return false;
  const r = result as Record<string, unknown>;
  return (
    r.toolName === "proposeTest" &&
    typeof r.toolCallId === "string" &&
    "output" in r &&
    typeof r.output === "object" &&
    r.output !== null &&
    "success" in (r.output as Record<string, unknown>) &&
    "id" in (r.output as Record<string, unknown>)
  );
};

export const isWriteTestFileResult = (
  result: unknown,
): result is WriteTestFileToolResult => {
  if (typeof result !== "object" || result === null) return false;
  const r = result as Record<string, unknown>;
  return (
    r.toolName === "writeTestFile" &&
    typeof r.toolCallId === "string" &&
    "output" in r &&
    typeof r.output === "object" &&
    r.output !== null &&
    "success" in (r.output as Record<string, unknown>) &&
    "filePath" in (r.output as Record<string, unknown>)
  );
};

export const isProposeTestCall = (
  call: unknown,
): call is ProposeTestToolCall => {
  if (typeof call !== "object" || call === null) return false;
  const c = call as Record<string, unknown>;
  return (
    c.toolName === "proposeTest" &&
    typeof c.toolCallId === "string" &&
    "input" in c &&
    typeof c.input === "object" &&
    c.input !== null &&
    "sourceFile" in (c.input as Record<string, unknown>) &&
    "targetTestPath" in (c.input as Record<string, unknown>)
  );
};

export const isWriteTestFileCall = (
  call: unknown,
): call is WriteTestFileToolCall => {
  if (typeof call !== "object" || call === null) return false;
  const c = call as Record<string, unknown>;
  return c.toolName === "writeTestFile" && typeof c.toolCallId === "string";
};

// ============================================================
// Tool Result Extraction
// ============================================================

export interface ExtractedToolResult<TOutput> {
  toolCallId: string;
  output: TOutput;
  input: unknown;
}

export const extractToolResults = <TOutput>(
  steps: ReadonlyArray<{
    toolCalls?: ReadonlyArray<unknown>;
    toolResults?: ReadonlyArray<unknown>;
  }>,
  isValidResult: (result: unknown) => result is {
    toolName: string;
    toolCallId: string;
    output: TOutput;
  },
): ExtractedToolResult<TOutput>[] => {
  const results: ExtractedToolResult<TOutput>[] = [];

  for (const step of steps) {
    for (const toolResult of step.toolResults ?? []) {
      if (!isValidResult(toolResult)) continue;

      // Find matching tool call for input
      const matchingCall = step.toolCalls?.find(
        (call): call is { toolCallId: string; input: unknown } =>
          typeof call === "object" &&
          call !== null &&
          "toolCallId" in call &&
          (call as { toolCallId: unknown }).toolCallId ===
            toolResult.toolCallId,
      );

      results.push({
        toolCallId: toolResult.toolCallId,
        output: toolResult.output,
        input: matchingCall?.input,
      });
    }
  }
  return results;
};

// ============================================================
// Stream Event Processing
// ============================================================

export interface StreamEventHandlers {
  onToolCall?: (
    toolName: string,
    args: unknown,
    toolCallId: string | undefined,
  ) => Effect.Effect<void, TestingAgentError>;
  onTextDelta?: (content: string) => Effect.Effect<void, never>;
  onToolResult?: (
    toolName: string,
    result: unknown,
  ) => Effect.Effect<void, never>;
  onFinish?: () => Effect.Effect<void, never>;
  signal?: AbortSignal;
  correlationId: string;
}

export const processStreamEvents = (
  eventStream: Stream.Stream<AgentStreamEvent, Error, never>,
  handlers: StreamEventHandlers,
): Effect.Effect<void, TestingAgentError, never> =>
  eventStream.pipe(
    Stream.mapError(
      (error) =>
        new TestingAgentError({
          message: error instanceof Error ? error.message : "Unknown error",
          cause: error,
        }),
    ),
    Stream.runForEach((event) =>
      Effect.gen(function* () {
        // Check abort signal
        if (handlers.signal?.aborted) {
          yield* Effect.logDebug(
            `[TestingAgent:${handlers.correlationId}] Abort signal detected`,
          );
          return yield* Effect.fail(
            new TestingAgentError({ message: "Operation cancelled by user" }),
          );
        }

        yield* Match.value(event.type).pipe(
          Match.when(
            "tool-call",
            () =>
              handlers.onToolCall?.(
                event.toolName ?? "unknown",
                event.toolArgs,
                event.toolCallId,
              ) ?? Effect.void,
          ),
          Match.when("text-delta", () =>
            event.content
              ? (handlers.onTextDelta?.(event.content) ?? Effect.void)
              : Effect.void,
          ),
          Match.when(
            "tool-result",
            () =>
              handlers.onToolResult?.(
                event.toolName ?? "unknown",
                event.toolResult,
              ) ?? Effect.void,
          ),
          Match.when("finish", () => handlers.onFinish?.() ?? Effect.void),
          Match.orElse(() => Effect.void),
        );
      }),
    ),
  );

// ============================================================
// Progress Message Helpers
// ============================================================

export const getToolProgressMessage = (
  toolName: string,
  args?: { command?: string },
): { status: ProgressStatus; message: string } | null => {
  switch (toolName) {
    case "semanticSearch":
      return {
        status: "searching",
        message: "Searching codebase for context...",
      };
    case "proposeTest":
      return { status: "proposing", message: "Generating test proposal..." };
    case "writeTestFile":
      return { status: "writing", message: "Writing test file..." };
    case "bashExecute": {
      const command = args?.command ?? "";
      if (
        command.includes("cat ") ||
        command.includes("head ") ||
        command.includes("tail ")
      ) {
        return { status: "reading", message: "Reading file contents..." };
      }
      if (command.includes("find ") || command.includes("ls ")) {
        return {
          status: "scanning",
          message: "Scanning directory structure...",
        };
      }
      return { status: "executing", message: "Running command..." };
    }
    default:
      return null;
  }
};

// ============================================================
// Correlation ID Generator
// ============================================================

export const generateCorrelationId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
