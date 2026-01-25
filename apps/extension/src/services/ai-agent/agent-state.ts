/**
 * Agent State Management Module
 * Provides Effect-based state management for the testing agent
 * Uses Ref and HashMap for declarative, immutable state updates
 */

import { Effect, HashMap, Ref } from "effect";
import type { Message } from "./context-tracker.js";

/**
 * Execution record for a test file write
 */
export interface Execution {
  testId: string;
  filePath?: string;
}

/**
 * Core agent state tracking conversation and execution
 */
export interface AgentState {
  messages: Message[];
  executions: Execution[];
  didRejectTool: boolean;
  taskCompleted: boolean;
  consecutiveMistakes: number;
}

/**
 * Streaming state for tracking tool calls and file operations
 */
export interface StreamingState {
  commandToToolCallId: HashMap.HashMap<string, string>;
  fileToToolCallId: HashMap.HashMap<string, string>;
  planToToolCallId: HashMap.HashMap<string, string>;
  streamingArgsText: HashMap.HashMap<string, string>;
  planInitializationStatus: HashMap.HashMap<string, Promise<boolean>>;
}

/**
 * Create initial agent state
 */
export const createAgentState = (
  initialMessages: Message[] = [],
): Effect.Effect<Ref.Ref<AgentState>> =>
  Ref.make<AgentState>({
    messages: initialMessages,
    executions: [],
    didRejectTool: false,
    taskCompleted: false,
    consecutiveMistakes: 0,
  });

/**
 * Create initial streaming state with empty HashMaps
 */
export const createStreamingState = (): Effect.Effect<
  Ref.Ref<StreamingState>
> =>
  Ref.make<StreamingState>({
    commandToToolCallId: HashMap.empty(),
    fileToToolCallId: HashMap.empty(),
    planToToolCallId: HashMap.empty(),
    streamingArgsText: HashMap.empty(),
    planInitializationStatus: HashMap.empty(),
  });

/**
 * Update messages in agent state
 */
export const setMessages = (
  stateRef: Ref.Ref<AgentState>,
  messages: Message[],
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    messages,
  }));

/**
 * Add execution to agent state
 */
export const addExecution = (
  stateRef: Ref.Ref<AgentState>,
  execution: Execution,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    executions: [...state.executions, execution],
  }));

/**
 * Set tool rejection flag
 */
export const setToolRejected = (
  stateRef: Ref.Ref<AgentState>,
  rejected: boolean,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    didRejectTool: rejected,
  }));

/**
 * Set task completed flag
 */
export const setTaskCompleted = (
  stateRef: Ref.Ref<AgentState>,
  completed: boolean,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    taskCompleted: completed,
  }));

/**
 * Increment consecutive mistakes counter
 */
export const incrementMistakes = (
  stateRef: Ref.Ref<AgentState>,
): Effect.Effect<number> =>
  Effect.gen(function* () {
    yield* Ref.update(stateRef, (state) => ({
      ...state,
      consecutiveMistakes: state.consecutiveMistakes + 1,
    }));
    const state = yield* Ref.get(stateRef);
    return state.consecutiveMistakes;
  });

/**
 * Reset consecutive mistakes counter
 */
export const resetMistakes = (
  stateRef: Ref.Ref<AgentState>,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    consecutiveMistakes: 0,
  }));

/**
 * Track command to toolCallId mapping
 */
export const trackCommandToolCall = (
  stateRef: Ref.Ref<StreamingState>,
  command: string,
  toolCallId: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    commandToToolCallId: HashMap.set(
      state.commandToToolCallId,
      command,
      toolCallId,
    ),
  }));

/**
 * Get toolCallId for a command
 */
export const getToolCallIdForCommand = (
  stateRef: Ref.Ref<StreamingState>,
  command: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const option = HashMap.get(state.commandToToolCallId, command);
    return option._tag === "Some" ? option.value : "";
  });

/**
 * Track file to toolCallId mapping
 */
export const trackFileToolCall = (
  stateRef: Ref.Ref<StreamingState>,
  filePath: string,
  toolCallId: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    fileToToolCallId: HashMap.set(state.fileToToolCallId, filePath, toolCallId),
  }));

/**
 * Get toolCallId for a file
 */
export const getToolCallIdForFile = (
  stateRef: Ref.Ref<StreamingState>,
  filePath: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const option = HashMap.get(state.fileToToolCallId, filePath);
    return option._tag === "Some" ? option.value : "";
  });

/**
 * Track plan to toolCallId mapping
 */
export const trackPlanToolCall = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
  filePath: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    planToToolCallId: HashMap.set(state.planToToolCallId, toolCallId, filePath),
  }));

/**
 * Get file path for a plan toolCallId
 */
export const getFilePathForPlan = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const option = HashMap.get(state.planToToolCallId, toolCallId);
    return option._tag === "Some" ? option.value : "";
  });

/**
 * Check if plan has toolCallId
 */
export const hasPlanToolCall = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    return HashMap.has(state.planToToolCallId, toolCallId);
  });

/**
 * Delete plan toolCallId mapping
 */
export const deletePlanToolCall = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    planToToolCallId: HashMap.remove(state.planToToolCallId, toolCallId),
  }));

/**
 * Store streaming args text
 */
export const setStreamingArgs = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
  argsText: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    streamingArgsText: HashMap.set(
      state.streamingArgsText,
      toolCallId,
      argsText,
    ),
  }));

/**
 * Get streaming args text
 */
export const getStreamingArgs = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<string> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const option = HashMap.get(state.streamingArgsText, toolCallId);
    return option._tag === "Some" ? option.value : "";
  });

/**
 * Check if streaming args exists
 */
export const hasStreamingArgs = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    return HashMap.has(state.streamingArgsText, toolCallId);
  });

/**
 * Delete streaming args
 */
export const deleteStreamingArgs = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    streamingArgsText: HashMap.remove(state.streamingArgsText, toolCallId),
  }));

/**
 * Store plan initialization status
 */
export const setPlanInitStatus = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
  promise: Promise<boolean>,
): Effect.Effect<void> =>
  Ref.update(stateRef, (state) => ({
    ...state,
    planInitializationStatus: HashMap.set(
      state.planInitializationStatus,
      toolCallId,
      promise,
    ),
  }));

/**
 * Get plan initialization status
 */
export const getPlanInitStatus = (
  stateRef: Ref.Ref<StreamingState>,
  toolCallId: string,
): Effect.Effect<Promise<boolean> | null> =>
  Effect.gen(function* () {
    const state = yield* Ref.get(stateRef);
    const option = HashMap.get(state.planInitializationStatus, toolCallId);
    return option._tag === "Some" ? option.value : null;
  });
