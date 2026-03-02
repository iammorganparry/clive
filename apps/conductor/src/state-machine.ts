/**
 * Task State Machine
 *
 * Manages validated state transitions for task lifecycle.
 *
 * State flow:
 * PENDING -> PLANNING -> SPAWNING -> BUILDING -> PR_OPEN -> REVIEWING -> COMPLETE
 *                                      ^                       |
 *                                      +---- (changes req.) ---+
 *              (can -> FAILED from any state)
 */

import { STATE_TRANSITIONS, type TaskState } from "./types.js";

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: TaskState,
    public readonly to: TaskState,
  ) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

/** Check if a state transition is valid */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return STATE_TRANSITIONS[from].includes(to);
}

/** Validate and return the new state, or throw */
export function transition(from: TaskState, to: TaskState): TaskState {
  if (!isValidTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  return to;
}

/** Check if a task is in a terminal state */
export function isTerminal(state: TaskState): boolean {
  return state === "complete" || state === "failed";
}

/** Check if a task is in an active (non-terminal) state */
export function isActive(state: TaskState): boolean {
  return !isTerminal(state);
}

/** Get all valid next states from current state */
export function nextStates(state: TaskState): TaskState[] {
  return STATE_TRANSITIONS[state];
}
