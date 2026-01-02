import * as vscode from "vscode";
import * as path from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { Data, Effect, Option, pipe, Runtime } from "effect";

// ============================================================
// Error Types
// ============================================================

export class PlanStreamingError extends Data.TaggedError("PlanStreamingError")<{
  message: string;
  cause?: unknown;
}> {}

export class NoWorkspaceError extends Data.TaggedError("NoWorkspaceError")<{
  message: string;
}> {}

export class StreamingNotInitializedError extends Data.TaggedError(
  "StreamingNotInitializedError",
)<{
  toolCallId: string;
}> {}

// ============================================================
// Input/Output Types
// ============================================================

/**
 * Input schema for proposeTestPlan tool
 * Enforces YAML frontmatter structure for plan output
 */
const ProposeTestPlanInputSchema = z.object({
  name: z.string().describe("Plan name (e.g., 'Test Plan for Authentication')"),
  overview: z
    .string()
    .describe("Brief description of what tests will cover (1-2 sentences)"),
  suites: z
    .array(
      z.object({
        id: z
          .string()
          .describe(
            "Unique identifier for the suite (e.g., 'suite-1-unit-auth')",
          ),
        name: z
          .string()
          .describe(
            "Human-readable name (e.g., 'Unit Tests for Authentication Logic')",
          ),
        testType: z
          .enum(["unit", "integration", "e2e"])
          .describe("Type of test suite"),
        targetFilePath: z
          .string()
          .describe(
            "Path where test file will be created (e.g., 'src/auth/__tests__/auth.test.ts')",
          ),
        sourceFiles: z
          .array(z.string())
          .describe("Source files that will be tested by this suite"),
        description: z
          .string()
          .optional()
          .describe("Brief description of what this suite tests"),
      }),
    )
    .describe(
      "Array of test suites to be created. Each suite will be processed individually in the queue.",
    ),
  mockDependencies: z
    .array(
      z.object({
        dependency: z
          .string()
          .describe(
            "Name of the dependency to mock (e.g., 'vscode', 'Database', 'AuthService')",
          ),
        existingMock: z
          .string()
          .optional()
          .describe(
            "Path to existing mock factory if found (e.g., '__tests__/mock-factories/vscode.ts')",
          ),
        mockStrategy: z
          .enum(["factory", "inline", "spy"])
          .describe(
            "How to mock: 'factory' (use/create centralized factory), 'inline' (simple inline mock), 'spy' (spy on real implementation)",
          ),
      }),
    )
    .describe(
      "All mock dependencies identified during planning. REQUIRED: Agent must identify all dependencies that need mocking.",
    ),
  externalDependencies: z
    .array(
      z.object({
        type: z
          .enum(["database", "api", "filesystem", "network"])
          .describe("Type of external dependency"),
        name: z
          .string()
          .describe(
            "Name or description of the dependency (e.g., 'PostgreSQL', 'Supabase', 'REST API')",
          ),
        testStrategy: z
          .string()
          .describe(
            "How to handle in tests: 'sandbox' (Docker/test env), 'mock' (mock the calls), 'skip' (not testing this)",
          ),
      }),
    )
    .optional()
    .describe(
      "External dependencies requiring special test setup (databases, APIs, etc.)",
    ),
  discoveredPatterns: z
    .object({
      testFramework: z
        .string()
        .describe(
          "Detected test framework (e.g., 'vitest', 'jest', 'playwright')",
        ),
      mockFactoryPaths: z
        .array(z.string())
        .describe(
          "Paths to existing mock factories found in codebase (e.g., ['__tests__/mock-factories/vscode.ts'])",
        ),
      testPatterns: z
        .array(z.string())
        .describe(
          "Key patterns found in similar tests (e.g., 'Uses vi.mock() for modules', 'Setup in beforeEach')",
        ),
    })
    .describe(
      "Patterns discovered during code analysis. REQUIRED: Agent must document patterns found in existing tests.",
    ),
  planContent: z
    .string()
    .describe(
      "The complete test plan in markdown format with YAML frontmatter. Must include:\n" +
        "- YAML frontmatter with name, overview, suites array\n" +
        "- Problem Summary section\n" +
        "- Implementation Plan with numbered sections\n" +
        "- Changes Summary footer",
    ),
});

export type ProposeTestPlanInput = z.infer<typeof ProposeTestPlanInputSchema>;

export interface ProposeTestPlanOutput {
  success: boolean;
  planId: string;
  name: string;
  overview: string;
  suites: Array<{
    id: string;
    name: string;
    testType: "unit" | "integration" | "e2e";
    targetFilePath: string;
    sourceFiles: string[];
    description?: string;
  }>;
  mockDependencies: Array<{
    dependency: string;
    existingMock?: string;
    mockStrategy: "factory" | "inline" | "spy";
  }>;
  externalDependencies?: Array<{
    type: "database" | "api" | "filesystem" | "network";
    name: string;
    testStrategy: string;
  }>;
  discoveredPatterns: {
    testFramework: string;
    mockFactoryPaths: string[];
    testPatterns: string[];
  };
  message: string;
  filePath?: string;
}

/**
 * Streaming file output callback type
 * Receives file path and content chunks as they're written
 */
export type StreamingFileOutputCallback = (chunk: {
  filePath: string;
  content: string;
  isComplete: boolean;
}) => void;

// ============================================================
// State Management
// ============================================================

/**
 * Streaming helper for writing plan content to files as it arrives
 */
interface PlanStreamingWriteState {
  fileUri: vscode.Uri;
  document?: vscode.TextDocument;
  editor?: vscode.TextEditor;
  accumulatedContent: string;
  isInitialized: boolean;
}

const planStreamingStates = new Map<string, PlanStreamingWriteState>();

// ============================================================
// Effect-based Helpers
// ============================================================

/**
 * Get workspace root as Effect
 */
const getWorkspaceRoot = (): Effect.Effect<vscode.Uri, NoWorkspaceError> =>
  pipe(
    Effect.sync(() => vscode.workspace.workspaceFolders),
    Effect.flatMap((folders) =>
      pipe(
        Option.fromNullable(folders?.[0]?.uri),
        Option.match({
          onNone: () =>
            Effect.fail(
              new NoWorkspaceError({ message: "No workspace folder found" }),
            ),
          onSome: (uri) => Effect.succeed(uri),
        }),
      ),
    ),
  );

/**
 * Resolve file path to Uri
 */
const resolveFilePath = (
  targetPath: string,
  workspaceRoot: vscode.Uri,
): vscode.Uri =>
  path.isAbsolute(targetPath)
    ? vscode.Uri.file(targetPath)
    : vscode.Uri.joinPath(workspaceRoot, targetPath);

/**
 * Ensure parent directory exists
 */
const ensureParentDirectory = (
  fileUri: vscode.Uri,
): Effect.Effect<void, PlanStreamingError> =>
  pipe(
    Effect.tryPromise({
      try: async () => {
        const parentDir = vscode.Uri.joinPath(fileUri, "..");
        try {
          await vscode.workspace.fs.stat(parentDir);
        } catch {
          await vscode.workspace.fs.createDirectory(parentDir);
        }
      },
      catch: (error) =>
        new PlanStreamingError({
          message: "Failed to ensure parent directory",
          cause: error,
        }),
    }),
  );

/**
 * Create empty file
 */
const createEmptyFile = (
  fileUri: vscode.Uri,
): Effect.Effect<void, PlanStreamingError> =>
  Effect.tryPromise({
    try: () => vscode.workspace.fs.writeFile(fileUri, Buffer.from("", "utf-8")),
    catch: (error) =>
      new PlanStreamingError({
        message: "Failed to create empty file",
        cause: error,
      }),
  });

/**
 * Open file in editor
 */
export const openFileInEditor = (
  fileUri: vscode.Uri,
): Effect.Effect<
  { document: vscode.TextDocument; editor: vscode.TextEditor },
  PlanStreamingError
> =>
  Effect.tryPromise({
    try: async () => {
      const document = await vscode.workspace.openTextDocument(fileUri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
        preserveFocus: false,
      });
      return { document, editor };
    },
    catch: (error) =>
      new PlanStreamingError({
        message: "Failed to open file in editor",
        cause: error,
      }),
  });

/**
 * Get streaming state as Option
 */
const getStreamingState = (
  toolCallId: string,
): Option.Option<PlanStreamingWriteState> =>
  Option.fromNullable(planStreamingStates.get(toolCallId));

/**
 * Get file path from streaming state for a given toolCallId
 * Returns undefined if streaming state doesn't exist or file hasn't been initialized
 */
export const getStreamingFilePath = (
  toolCallId: string,
): string | undefined => {
  const state = planStreamingStates.get(toolCallId);
  return state?.fileUri && state.isInitialized
    ? vscode.workspace.asRelativePath(state.fileUri, false)
    : undefined;
};

// ============================================================
// Effect-based Public API
// ============================================================

/**
 * Initialize streaming write for a plan file (Effect version)
 */
export const initializePlanStreamingWriteEffect = (
  targetPath: string,
  toolCallId: string,
): Effect.Effect<void, NoWorkspaceError | PlanStreamingError> =>
  Effect.gen(function* () {
    const workspaceRoot = yield* getWorkspaceRoot();
    const fileUri = resolveFilePath(targetPath, workspaceRoot);

    yield* ensureParentDirectory(fileUri);
    yield* createEmptyFile(fileUri);
    const { document, editor } = yield* openFileInEditor(fileUri);

    yield* Effect.sync(() =>
      planStreamingStates.set(toolCallId, {
        fileUri,
        document,
        editor,
        accumulatedContent: "",
        isInitialized: true,
      }),
    );
  });

/**
 * Append content chunk to streaming plan write (Effect version)
 */
export const appendPlanStreamingContentEffect = (
  toolCallId: string,
  contentChunk: string,
): Effect.Effect<void, StreamingNotInitializedError | PlanStreamingError> =>
  Effect.gen(function* () {
    const state = yield* pipe(
      getStreamingState(toolCallId),
      Option.match({
        onNone: () =>
          Effect.fail(new StreamingNotInitializedError({ toolCallId })),
        onSome: (s) =>
          s.isInitialized
            ? Effect.succeed(s)
            : Effect.fail(new StreamingNotInitializedError({ toolCallId })),
      }),
    );

    // Append content chunk to accumulated content
    state.accumulatedContent += contentChunk;

    yield* pipe(
      Option.fromNullable(
        state.editor && state.document
          ? { editor: state.editor, document: state.document }
          : null,
      ),
      Option.match({
        onNone: () =>
          // Fallback: write accumulated content directly
          Effect.tryPromise({
            try: () =>
              vscode.workspace.fs.writeFile(
                state.fileUri,
                Buffer.from(state.accumulatedContent, "utf-8"),
              ),
            catch: (error) =>
              new PlanStreamingError({
                message: "Failed to write accumulated content",
                cause: error,
              }),
          }),
        onSome: ({ document }) =>
          Effect.tryPromise({
            try: async () => {
              const edit = new vscode.WorkspaceEdit();
              // Replace entire document with full content
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length),
              );
              edit.replace(state.fileUri, fullRange, state.accumulatedContent);
              await vscode.workspace.applyEdit(edit);

              // Reload document
              state.document = await vscode.workspace.openTextDocument(
                state.fileUri,
              );
            },
            catch: (error) =>
              new PlanStreamingError({
                message: "Failed to apply edit",
                cause: error,
              }),
          }),
      }),
    );
  });

/**
 * Finalize streaming plan write and clean up state (Effect version)
 */
export const finalizePlanStreamingWriteEffect = (
  toolCallId: string,
): Effect.Effect<string, StreamingNotInitializedError | PlanStreamingError> =>
  Effect.gen(function* () {
    const state = yield* pipe(
      getStreamingState(toolCallId),
      Option.match({
        onNone: () =>
          Effect.fail(new StreamingNotInitializedError({ toolCallId })),
        onSome: Effect.succeed,
      }),
    );

    // Ensure final content is written
    yield* Effect.tryPromise({
      try: () =>
        vscode.workspace.fs.writeFile(
          state.fileUri,
          Buffer.from(state.accumulatedContent, "utf-8"),
        ),
      catch: (error) =>
        new PlanStreamingError({
          message: "Failed to write final content",
          cause: error,
        }),
    });

    const relativePath = vscode.workspace.asRelativePath(state.fileUri, false);

    // Clean up
    yield* Effect.sync(() => planStreamingStates.delete(toolCallId));

    return relativePath;
  });

// ============================================================
// Promise-based API (for AI SDK compatibility)
// ============================================================

const runtime = Runtime.defaultRuntime;

/**
 * Initialize streaming write for a plan file
 */
export async function initializePlanStreamingWrite(
  targetPath: string,
  toolCallId: string,
): Promise<{ success: boolean; error?: string }> {
  return pipe(
    initializePlanStreamingWriteEffect(targetPath, toolCallId),
    Effect.match({
      onSuccess: () => ({ success: true }),
      onFailure: (error) => ({
        success: false,
        error: error.message ?? "Unknown error",
      }),
    }),
    Runtime.runPromise(runtime),
  );
}

/**
 * Append content chunk to streaming plan write
 */
export async function appendPlanStreamingContent(
  toolCallId: string,
  contentChunk: string,
): Promise<{ success: boolean; error?: string }> {
  return pipe(
    appendPlanStreamingContentEffect(toolCallId, contentChunk),
    Effect.match({
      onSuccess: () => ({ success: true }),
      onFailure: (error) => {
        if (error._tag === "StreamingNotInitializedError") {
          return { success: false, error: "Streaming write not initialized" };
        }
        if (error._tag === "PlanStreamingError") {
          return {
            success: false,
            error: error.message ?? "Failed to append content",
          };
        }
        return { success: false, error: "Unknown error" };
      },
    }),
    Runtime.runPromise(runtime),
  );
}

/**
 * Finalize streaming plan write and clean up state
 */
export async function finalizePlanStreamingWrite(
  toolCallId: string,
): Promise<{ success: boolean; filePath: string; error?: string }> {
  return pipe(
    finalizePlanStreamingWriteEffect(toolCallId),
    Effect.match({
      onSuccess: (filePath) => ({ success: true, filePath }),
      onFailure: (error) => ({
        success: false,
        filePath: "",
        error:
          error._tag === "StreamingNotInitializedError"
            ? "Streaming write not found"
            : (error.message ?? "Unknown error"),
      }),
    }),
    Runtime.runPromise(runtime),
  );
}

// ============================================================
// Plan ID Generation
// ============================================================

/**
 * Generate a unique plan ID
 */
const generatePlanId = (): Effect.Effect<string> =>
  Effect.sync(
    () => `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  );

/**
 * Generate a unique tool call ID
 */
const generateToolCallId = (): Effect.Effect<string> =>
  Effect.sync(
    () =>
      `propose-plan-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  );

/**
 * Create output result from input and approval status
 */
const createOutputResult = (
  input: ProposeTestPlanInput,
  planId: string,
  approved: boolean,
  filePath?: string,
): ProposeTestPlanOutput => ({
  success: approved,
  planId,
  name: input.name,
  overview: input.overview,
  suites: input.suites,
  mockDependencies: input.mockDependencies,
  externalDependencies: input.externalDependencies,
  discoveredPatterns: input.discoveredPatterns,
  message: approved
    ? `Test plan proposal created: ${input.name}`
    : `Test plan proposal rejected: ${input.name}`,
  filePath,
});

// ============================================================
// Tool Factory
// ============================================================

/**
 * Factory function to create proposeTestPlanTool
 * Creates a markdown plan file and opens it in the editor
 */
export const createProposeTestPlanTool = (
  _fileStreamingCallback?: StreamingFileOutputCallback,
) =>
  tool({
    description:
      "Output a structured test plan proposal in markdown format with YAML frontmatter. " +
      "This tool should be used in PLAN MODE to present a comprehensive test strategy " +
      "for user review before writing any test files. The plan must follow the structured " +
      "format defined in the system prompt with YAML frontmatter, Problem Summary, " +
      "Implementation Plan sections, and Changes Summary. " +
      "CRITICAL: You MUST populate mockDependencies, discoveredPatterns, and externalDependencies " +
      "based on your thorough discovery phase. These fields ensure act mode has all required context.",
    inputSchema: ProposeTestPlanInputSchema,
    execute: (input, options): Promise<ProposeTestPlanOutput> =>
      pipe(
        Effect.gen(function* () {
          const planId = yield* generatePlanId();
          const toolCallId =
            options?.toolCallId ?? (yield* generateToolCallId());

          // File writing is handled by streaming event handlers
          // Get filePath from streaming state (set by event handlers during streaming)
          const filePath = getStreamingFilePath(toolCallId);

          return createOutputResult(input, planId, true, filePath);
        }),
        Runtime.runPromise(runtime),
      ),
  });

/**
 * Default proposeTestPlanTool without streaming callback
 */
export const proposeTestPlanTool = createProposeTestPlanTool();
