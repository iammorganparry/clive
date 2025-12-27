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
  name: z
    .string()
    .describe("Plan name (e.g., 'Test Plan for Authentication')"),
  overview: z
    .string()
    .describe("Brief description of what tests will cover (1-2 sentences)"),
  todos: z
    .array(z.string())
    .describe("List of test types to be created (e.g., ['unit-tests', 'integration-tests', 'e2e-tests'])"),
  planContent: z
    .string()
    .describe(
      "The complete test plan in markdown format with YAML frontmatter. Must include:\n" +
        "- YAML frontmatter with name, overview, todos\n" +
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
  todos: string[];
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
    try: () =>
      vscode.workspace.fs.writeFile(fileUri, Buffer.from("", "utf-8")),
    catch: (error) =>
      new PlanStreamingError({
        message: "Failed to create empty file",
        cause: error,
      }),
  });

/**
 * Open file in editor
 */
const openFileInEditor = (
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

    // Update accumulated content
    state.accumulatedContent += contentChunk;

    yield* pipe(
      Option.fromNullable(
        state.editor && state.document ? { editor: state.editor, document: state.document } : null,
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
              const endPosition = document.positionAt(
                state.accumulatedContent.length - contentChunk.length,
              );
              edit.insert(state.fileUri, endPosition, contentChunk);
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
): ProposeTestPlanOutput => ({
  success: approved,
  planId,
  name: input.name,
  overview: input.overview,
  todos: input.todos,
  message: approved
    ? `Test plan proposal created: ${input.name}`
    : `Test plan proposal rejected: ${input.name}`,
});

/**
 * Register plan ID in approval registry if approved
 */
const registerApproval = (
  planId: string,
  approved: boolean,
  registry: Set<string> | undefined,
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (approved && registry) {
      registry.add(planId);
    }
  });

// ============================================================
// Tool Factory
// ============================================================

/**
 * Factory function to create proposeTestPlanTool with optional approval callback
 * When no approval callback is provided, proposals are auto-approved
 */
export const createProposeTestPlanTool = (
  waitForApproval?: (
    toolCallId: string,
    input: ProposeTestPlanInput,
  ) => Promise<boolean>,
  approvalRegistry?: Set<string>,
) =>
  tool({
    description:
      "Output a structured test plan proposal in markdown format with YAML frontmatter. " +
      "This tool should be used in PLAN MODE to present a comprehensive test strategy " +
      "for user review before writing any test files. The plan must follow the structured " +
      "format defined in the system prompt with YAML frontmatter, Problem Summary, " +
      "Implementation Plan sections, and Changes Summary.",
    inputSchema: ProposeTestPlanInputSchema,
    execute: (input): Promise<ProposeTestPlanOutput> =>
      pipe(
        Effect.gen(function* () {
          const planId = yield* generatePlanId();

          // Determine approval status
          const approved = yield* pipe(
            Option.fromNullable(waitForApproval),
            Option.match({
              // No approval callback = auto-approve
              onNone: () => Effect.succeed(true),
              // With approval callback = wait for approval
              onSome: (approvalFn) =>
                Effect.gen(function* () {
                  const toolCallId = yield* generateToolCallId();
                  return yield* Effect.tryPromise({
                    try: () => approvalFn(toolCallId, input),
                    catch: () => false, // Default to rejected on error
                  });
                }),
            }),
          );

          // Register in approval registry
          yield* registerApproval(planId, approved, approvalRegistry);

          return createOutputResult(input, planId, approved);
        }),
        Runtime.runPromise(runtime),
      ),
  });

/**
 * Default proposeTestPlanTool without approval callback (auto-approves)
 * Use createProposeTestPlanTool with waitForApproval for manual approval flow
 */
export const proposeTestPlanTool = createProposeTestPlanTool();

