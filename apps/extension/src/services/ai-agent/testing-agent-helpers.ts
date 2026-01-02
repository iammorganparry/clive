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

// ============================================================
// JSON Parsing Utilities
// ============================================================

/**
 * Sanitize a plan name for use in file paths
 * Converts to lowercase, replaces non-alphanumeric with hyphens
 */
export const sanitizePlanName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);

/**
 * Generate descriptive filename for test plan
 * Format: {sanitized-name}-{test-type}-{count}-{suite|suites}.md
 */
export const generatePlanFilename = (
  name: string,
  suitesInfo: ExtractedSuitesInfo,
): string => {
  const sanitizedName = sanitizePlanName(name);
  const suffix = suitesInfo.count === 1 ? "suite" : "suites";
  return `.clive/plans/${sanitizedName}-${suitesInfo.primaryTestType}-${suitesInfo.count}-${suffix}.md`;
};

/**
 * Unescape JSON string escapes
 * Converts \\n, \\t, \\", \\\\ to actual characters
 * Note: Order matters - backslash must be replaced first to avoid
 * false matches like \\t being interpreted as tab
 */
export const unescapeJsonString = (str: string): string =>
  str
    .replace(/\\\\/g, "\0BACKSLASH\0") // Temporarily replace escaped backslashes
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\0BACKSLASH\0/g, "\\"); // Restore backslashes

/**
 * Extract a JSON field value from partial/incomplete JSON string
 * Handles streaming JSON where the string may not be complete
 * Returns the field value (still escaped) or null if not found/incomplete
 */
export const extractJsonField = (
  json: string,
  field: string,
): string | null => {
  // Find the field key in the JSON
  const fieldPattern = `"${field}"\\s*:\\s*"`;
  const fieldIndex = json.search(new RegExp(fieldPattern));
  if (fieldIndex === -1) return null;

  // Find where the value string starts (after the opening quote)
  const valueStartIndex = json.indexOf('"', fieldIndex + field.length + 2) + 1;
  if (valueStartIndex === 0) return null;

  // Extract the string value by tracking escape sequences
  let extracted = "";
  let i = valueStartIndex;
  let inEscape = false;

  while (i < json.length) {
    const char = json[i];

    if (inEscape) {
      // Add escaped character as-is (we'll unescape later)
      extracted += char;
      inEscape = false;
    } else if (char === "\\") {
      // Start escape sequence
      extracted += char;
      inEscape = true;
    } else if (char === '"') {
      // Found unescaped closing quote - end of string
      return extracted;
    } else {
      // Regular character
      extracted += char;
    }
    i++;
  }

  // If we reach here, the string is incomplete (no closing quote yet)
  // Return what we have so far for streaming display
  return extracted || null;
};

/**
 * Extract suites information from partial JSON
 * Parses the suites array to get count and test types
 * Returns null if suites array is incomplete or not found
 */
export interface ExtractedSuitesInfo {
  count: number;
  primaryTestType: "unit" | "integration" | "e2e" | "mixed";
}

export const extractSuitesInfo = (json: string): ExtractedSuitesInfo | null => {
  // Find the suites field
  const suitesPattern = `"suites"\\s*:\\s*\\[`;
  const suitesIndex = json.search(new RegExp(suitesPattern));
  if (suitesIndex === -1) return null;

  // Find where the array starts (after the opening bracket)
  const arrayStartIndex = json.indexOf("[", suitesIndex);
  if (arrayStartIndex === -1) return null;

  // Extract array content by counting brackets
  let depth = 0;
  let i = arrayStartIndex;
  let arrayContent = "";
  let inString = false;
  let escapeNext = false;

  while (i < json.length) {
    const char = json[i];

    if (escapeNext) {
      arrayContent += char;
      escapeNext = false;
      i++;
      continue;
    }

    if (char === "\\") {
      arrayContent += char;
      escapeNext = true;
      i++;
      continue;
    }

    if (char === '"' && !escapeNext) {
      inString = !inString;
      arrayContent += char;
      i++;
      continue;
    }

    if (!inString) {
      if (char === "[") {
        depth++;
        arrayContent += char;
      } else if (char === "]") {
        depth--;
        arrayContent += char;
        if (depth === 0) {
          // Found complete array
          break;
        }
      } else {
        arrayContent += char;
      }
    } else {
      arrayContent += char;
    }

    i++;
  }

  // If depth is not 0, array is incomplete
  if (depth !== 0) return null;

  // Try to parse the array content
  try {
    // Count objects in the array by counting complete objects
    // A complete object has balanced braces
    let objectCount = 0;
    let objectDepth = 0;
    let inObjectString = false;
    let objectEscapeNext = false;
    let objectStart = -1;

    for (let j = 0; j < arrayContent.length; j++) {
      const char = arrayContent[j];

      if (objectEscapeNext) {
        objectEscapeNext = false;
        continue;
      }

      if (char === "\\") {
        objectEscapeNext = true;
        continue;
      }

      if (char === '"' && !objectEscapeNext) {
        inObjectString = !inObjectString;
        continue;
      }

      if (!inObjectString) {
        if (char === "{") {
          if (objectDepth === 0) {
            objectStart = j;
          }
          objectDepth++;
        } else if (char === "}") {
          objectDepth--;
          if (objectDepth === 0 && objectStart !== -1) {
            // Found a complete object
            objectCount++;
            objectStart = -1;
          }
        }
      }
    }

    // Extract testType values from the array
    const testTypes: Array<"unit" | "integration" | "e2e"> = [];
    const testTypePattern = /"testType"\s*:\s*"(\w+)"/g;
    let match: RegExpExecArray | null;
    match = testTypePattern.exec(arrayContent);
    while (match !== null) {
      const testType = match[1];
      if (
        testType === "unit" ||
        testType === "integration" ||
        testType === "e2e"
      ) {
        testTypes.push(testType);
      }
      match = testTypePattern.exec(arrayContent);
    }

    if (objectCount === 0 && testTypes.length === 0) {
      // Array might be empty or incomplete
      return null;
    }

    // Determine primary test type
    let primaryTestType: "unit" | "integration" | "e2e" | "mixed" = "mixed";
    if (testTypes.length > 0) {
      const typeCounts = {
        unit: 0,
        integration: 0,
        e2e: 0,
      };
      for (const type of testTypes) {
        typeCounts[type]++;
      }

      const maxCount = Math.max(
        typeCounts.unit,
        typeCounts.integration,
        typeCounts.e2e,
      );
      const uniqueTypes = [
        typeCounts.unit > 0 ? "unit" : null,
        typeCounts.integration > 0 ? "integration" : null,
        typeCounts.e2e > 0 ? "e2e" : null,
      ].filter((t): t is string => t !== null);

      if (uniqueTypes.length === 1) {
        primaryTestType = uniqueTypes[0] as "unit" | "integration" | "e2e";
      } else if (maxCount === testTypes.length) {
        // All suites have the same type
        primaryTestType = Object.entries(typeCounts).find(
          ([, count]) => count === maxCount,
        )?.[0] as "unit" | "integration" | "e2e";
      } else {
        primaryTestType = "mixed";
      }
    }

    // Use objectCount if we found complete objects, otherwise use testTypes.length
    const count = objectCount > 0 ? objectCount : testTypes.length;

    return {
      count,
      primaryTestType,
    };
  } catch {
    // Parsing failed, array might be incomplete
    return null;
  }
};
