/**
 * Ralph Wiggum Loop State Management
 *
 * Manages the continuous loop state for the testing agent.
 * The agent iterates until all test suites are written and pass.
 *
 * Core concept: Agent sees filesystem state (not message history) each iteration.
 */

import { type Effect, Ref } from "effect";

/**
 * Safety limits for the loop
 */
export const LOOP_SAFETY_LIMITS = {
  /** Maximum number of iterations before stopping */
  MAX_ITERATIONS: 10,
  /** Maximum time per iteration in milliseconds (5 minutes) */
  MAX_ITERATION_TIME_MS: 300_000,
  /** Maximum total time in milliseconds (30 minutes) */
  MAX_TOTAL_TIME_MS: 1_800_000,
  /** Stop if this many iterations fail consecutively */
  MAX_CONSECUTIVE_FAILURES: 3,
} as const;

/**
 * Test results for a todo item
 */
export interface TodoTestResults {
  passed: number;
  failed: number;
  error?: string;
}

/**
 * A single todo item representing a test suite to implement
 * Mirrors Claude Code's native TodoWrite schema
 */
export interface TodoItem {
  /** Unique identifier for this todo */
  id: string;
  /** What needs to be done (imperative form) */
  content: string;
  /** Present continuous form for display during execution */
  activeForm: string;
  /** Current status of this todo */
  status: "pending" | "in_progress" | "completed" | "failed";
  /** Target test file path */
  targetFilePath?: string;
  /** Source files being tested */
  sourceFiles?: string[];
  /** Test type */
  testType?: "unit" | "integration" | "e2e";
  /** Test execution results */
  testResults?: TodoTestResults;
}

/**
 * Exit reason for the loop
 */
export type LoopExitReason =
  | "complete"
  | "max_iterations"
  | "max_time"
  | "error"
  | "cancelled";

/**
 * State for the Ralph Wiggum loop
 */
export interface LoopState {
  /** Current iteration number (1-indexed) */
  iteration: number;
  /** Maximum iterations allowed */
  maxIterations: number;
  /** List of todos to complete */
  todos: TodoItem[];
  /** Start time of the loop in milliseconds */
  startTime: number;
  /** Time of the last iteration start */
  lastIterationTime: number;
  /** Whether all tests have passed */
  allTestsPassed: boolean;
  /** Number of consecutive failed iterations */
  consecutiveFailures: number;
  /** Reason for exiting the loop (set when loop ends) */
  exitReason?: LoopExitReason;
}

/**
 * Test suite info from a proposed test plan
 */
export interface TestSuiteInfo {
  id: string;
  name: string;
  testType: "unit" | "integration" | "e2e";
  targetFilePath: string;
  sourceFiles: string[];
  description?: string;
}

/**
 * Create initial loop state from test suites
 */
export const createLoopState = (
  suites: TestSuiteInfo[],
  maxIterations: number = LOOP_SAFETY_LIMITS.MAX_ITERATIONS,
): LoopState => {
  const now = Date.now();

  const todos: TodoItem[] = suites.map((suite) => ({
    id: suite.id,
    content: `Write ${suite.testType} tests for ${suite.name}`,
    activeForm: `Writing ${suite.testType} tests for ${suite.name}`,
    status: "pending" as const,
    targetFilePath: suite.targetFilePath,
    sourceFiles: suite.sourceFiles,
    testType: suite.testType,
  }));

  return {
    iteration: 0,
    maxIterations,
    todos,
    startTime: now,
    lastIterationTime: now,
    allTestsPassed: false,
    consecutiveFailures: 0,
  };
};

/**
 * Create an empty loop state (for plan mode or when no suites)
 */
export const createEmptyLoopState = (): LoopState => ({
  iteration: 0,
  maxIterations: LOOP_SAFETY_LIMITS.MAX_ITERATIONS,
  todos: [],
  startTime: Date.now(),
  lastIterationTime: Date.now(),
  allTestsPassed: false,
  consecutiveFailures: 0,
});

/**
 * Check if the loop should continue
 */
export const shouldContinueLoop = (state: LoopState): boolean => {
  // Explicit exit reason set
  if (state.exitReason) {
    return false;
  }

  // All tests passed
  if (state.allTestsPassed) {
    return false;
  }

  // Max iterations reached
  if (state.iteration >= state.maxIterations) {
    return false;
  }

  // Total time exceeded
  const totalTime = Date.now() - state.startTime;
  if (totalTime > LOOP_SAFETY_LIMITS.MAX_TOTAL_TIME_MS) {
    return false;
  }

  // Too many consecutive failures
  if (state.consecutiveFailures >= LOOP_SAFETY_LIMITS.MAX_CONSECUTIVE_FAILURES) {
    return false;
  }

  // Allow first iteration to bootstrap todos from plan file
  // Agent will use TodoWrite to create tasks from the plan
  if (state.iteration === 0 && state.todos.length === 0) {
    return true;
  }

  // Check if there's still work to do
  const pendingTodos = state.todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  );
  const failedTodos = state.todos.filter((t) => t.status === "failed");

  // Continue if there are pending todos
  if (pendingTodos.length > 0) {
    return true;
  }

  // Continue if there are failed todos and we haven't exceeded retry limit
  if (failedTodos.length > 0 && state.consecutiveFailures < LOOP_SAFETY_LIMITS.MAX_CONSECUTIVE_FAILURES) {
    return true;
  }

  return false;
};

/**
 * Determine why the loop should exit
 */
export const getExitReason = (state: LoopState): LoopExitReason | null => {
  if (state.exitReason) {
    return state.exitReason;
  }

  if (state.allTestsPassed) {
    return "complete";
  }

  if (state.iteration >= state.maxIterations) {
    return "max_iterations";
  }

  const totalTime = Date.now() - state.startTime;
  if (totalTime > LOOP_SAFETY_LIMITS.MAX_TOTAL_TIME_MS) {
    return "max_time";
  }

  if (state.consecutiveFailures >= LOOP_SAFETY_LIMITS.MAX_CONSECUTIVE_FAILURES) {
    return "error";
  }

  return null;
};

/**
 * Update a todo's status
 */
export const updateTodoStatus = (
  state: LoopState,
  todoId: string,
  status: TodoItem["status"],
  testResults?: TodoTestResults,
): LoopState => {
  const updatedTodos = state.todos.map((todo) => {
    if (todo.id === todoId) {
      return {
        ...todo,
        status,
        testResults: testResults ?? todo.testResults,
      };
    }
    return todo;
  });

  // Check if all tests passed
  const allCompleted = updatedTodos.every((t) => t.status === "completed");
  const allPassed = updatedTodos.every(
    (t) =>
      t.status === "completed" &&
      t.testResults &&
      t.testResults.passed > 0 &&
      t.testResults.failed === 0,
  );

  return {
    ...state,
    todos: updatedTodos,
    allTestsPassed: allCompleted && allPassed,
  };
};

/**
 * Update todos from TodoWrite tool input
 */
export const updateTodosFromInput = (
  state: LoopState,
  input: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
    activeForm: string;
  }>,
): LoopState => {
  // Match by content or create new todos
  const updatedTodos = input.map((inputTodo, index) => {
    const existingTodo = state.todos.find(
      (t) => t.content === inputTodo.content || t.id === `todo-${index}`,
    );

    if (existingTodo) {
      return {
        ...existingTodo,
        status: inputTodo.status === "completed" ? "completed" as const : inputTodo.status,
        activeForm: inputTodo.activeForm,
      };
    }

    return {
      id: `todo-${index}`,
      content: inputTodo.content,
      activeForm: inputTodo.activeForm,
      status: inputTodo.status === "completed" ? "completed" as const : inputTodo.status,
    };
  });

  // Check if all tests passed
  const allCompleted = updatedTodos.every((t) => t.status === "completed");

  return {
    ...state,
    todos: updatedTodos,
    allTestsPassed: allCompleted,
  };
};

/**
 * Increment iteration counter
 */
export const incrementIteration = (state: LoopState): LoopState => ({
  ...state,
  iteration: state.iteration + 1,
  lastIterationTime: Date.now(),
});

/**
 * Record a failed iteration
 */
export const recordFailedIteration = (state: LoopState): LoopState => ({
  ...state,
  consecutiveFailures: state.consecutiveFailures + 1,
});

/**
 * Reset consecutive failures (on successful progress)
 */
export const resetFailures = (state: LoopState): LoopState => ({
  ...state,
  consecutiveFailures: 0,
});

/**
 * Set exit reason
 */
export const setExitReason = (
  state: LoopState,
  reason: LoopExitReason,
): LoopState => ({
  ...state,
  exitReason: reason,
});

/**
 * Get the next pending todo
 */
export const getNextPendingTodo = (state: LoopState): TodoItem | null => {
  return (
    state.todos.find(
      (t) => t.status === "pending" || t.status === "in_progress",
    ) ?? null
  );
};

/**
 * Get summary of current progress
 */
export const getProgressSummary = (
  state: LoopState,
): {
  completed: number;
  pending: number;
  failed: number;
  total: number;
  percentComplete: number;
} => {
  const completed = state.todos.filter((t) => t.status === "completed").length;
  const pending = state.todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  ).length;
  const failed = state.todos.filter((t) => t.status === "failed").length;
  const total = state.todos.length;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, pending, failed, total, percentComplete };
};

/**
 * Build iteration prompt for the agent
 * Agent sees filesystem state, not message history
 */
export const buildIterationPrompt = (
  state: LoopState,
  workspaceRoot: string,
  planFilePath?: string,
): string => {
  // Bootstrap case: first iteration with no todos yet
  // Agent needs to read plan file and create todos
  if (state.iteration === 0 && state.todos.length === 0) {
    return `You are starting a new test implementation session.

## Bootstrap Instructions

${planFilePath ? `1. Read the test plan file at: ${planFilePath}
2. Extract the test suites from the plan
3. Use the TodoWrite tool to create a todo for each test suite
4. Then start implementing the first test suite` : `1. Review the test requirements
2. Use the TodoWrite tool to create todos for each test suite you need to implement
3. Then start implementing the first test suite`}

## TodoWrite Example

After reading the plan, use TodoWrite to create your task list:
\`\`\`json
{
  "todos": [
    { "content": "Write unit tests for auth.ts", "status": "in_progress", "activeForm": "Writing unit tests for auth.ts" },
    { "content": "Write integration tests for api.ts", "status": "pending", "activeForm": "Writing integration tests for api.ts" }
  ]
}
\`\`\`

IMPORTANT:
- Create ALL todos from the plan before starting implementation
- Mark the first task as in_progress
- Only work on ONE suite at a time

Workspace root: ${workspaceRoot}`;
  }

  const progress = getProgressSummary(state);
  const pendingTodos = state.todos.filter(
    (t) => t.status === "pending" || t.status === "in_progress" || t.status === "failed",
  );

  const todoList = pendingTodos
    .map((t) => {
      const status = t.status === "failed" ? " (FAILED - needs retry)" : "";
      const target = t.targetFilePath ? ` -> ${t.targetFilePath}` : "";
      return `- ${t.content}${target}${status}`;
    })
    .join("\n");

  return `Continue implementing test suites. This is iteration ${state.iteration} of ${state.maxIterations}.

## Current Progress
- Completed: ${progress.completed}/${progress.total} suites (${progress.percentComplete}%)
- Remaining: ${progress.pending + progress.failed} suites
- Failed (need retry): ${progress.failed} suites

## Remaining Work
${todoList}

## Instructions
1. Check the filesystem for any test files already written in previous iterations
2. ${planFilePath ? `Read ${planFilePath} for implementation details` : "Follow the approved test plan"}
3. Use the todoWrite tool to mark tasks as in_progress before starting
4. Write the test file and verify it passes (run tests with bash)
5. Use the todoWrite tool to mark tasks as completed when tests pass

IMPORTANT:
- Only work on ONE suite at a time
- Mark tasks completed ONLY when tests actually pass
- If tests fail, mark the task as failed and move to the next one
- Check existing files before writing (don't overwrite working tests)

Workspace root: ${workspaceRoot}`;
};

/**
 * Create a Ref containing the loop state
 */
export const makeLoopStateRef = (
  suites: TestSuiteInfo[],
  maxIterations?: number,
): Effect.Effect<Ref.Ref<LoopState>> =>
  Ref.make(createLoopState(suites, maxIterations));

/**
 * Create an empty Ref for cases where loop state isn't needed
 */
export const makeEmptyLoopStateRef = (): Effect.Effect<Ref.Ref<LoopState>> =>
  Ref.make(createEmptyLoopState());
