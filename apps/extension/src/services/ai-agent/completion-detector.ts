/**
 * Completion Detector Service
 * Detects when the agent has completed its task using a delimiter in the output
 * Used with the AI SDK's stopWhen callback for unlimited step execution
 */

import type { ToolSet } from "ai";
import { Effect, Ref } from "effect";

/**
 * The delimiter that signals the agent has completed all tasks
 */
export const COMPLETION_DELIMITER = "[COMPLETE]" as const;

/**
 * Step result type from the AI SDK
 */
interface StepResult {
  readonly text: string;
  readonly content?: unknown[];
}

/**
 * Completion state tracked during agent execution
 */
export interface CompletionState {
  isComplete: boolean;
  completedAtStep: number | null;
  accumulatedText: string;
}

/**
 * Completion Detector Service
 * Tracks agent output and detects completion delimiter
 */
export class CompletionDetector extends Effect.Service<CompletionDetector>()(
  "CompletionDetector",
  {
    effect: Effect.gen(function* () {
      return {
        /**
         * Create a new completion state ref for a conversation
         */
        createState: () =>
          Ref.make<CompletionState>({
            isComplete: false,
            completedAtStep: null,
            accumulatedText: "",
          }),

        /**
         * Create a stopWhen callback for the AI SDK
         * Returns true when the completion delimiter is detected
         */
        createStopCondition: <_TOOLS extends ToolSet>(
          stateRef: Ref.Ref<CompletionState>,
        ) => {
          return (options: { steps: Array<StepResult> }): boolean => {
            const { steps } = options;
            if (steps.length === 0) return false;

            // Check the most recent step for the completion delimiter
            const lastStep = steps[steps.length - 1];
            if (!lastStep) return false;

            const text = lastStep.text || "";

            // Check if this step contains the completion delimiter
            if (text.includes(COMPLETION_DELIMITER)) {
              // Update state synchronously (we're in a sync callback)
              // Use runSync since we need immediate result
              Effect.runSync(
                Ref.update(stateRef, (state) => ({
                  ...state,
                  isComplete: true,
                  completedAtStep: steps.length,
                  accumulatedText: state.accumulatedText + text,
                })),
              );
              return true;
            }

            // Accumulate text for tracking
            Effect.runSync(
              Ref.update(stateRef, (state) => ({
                ...state,
                accumulatedText: state.accumulatedText + text,
              })),
            );

            return false;
          };
        },

        /**
         * Check if the agent output contains the completion delimiter
         */
        hasCompletionDelimiter: (text: string): boolean => {
          return text.includes(COMPLETION_DELIMITER);
        },

        /**
         * Get the completion state
         */
        getState: (stateRef: Ref.Ref<CompletionState>) => Ref.get(stateRef),

        /**
         * Strip the completion delimiter from text for display
         */
        stripDelimiter: (text: string): string => {
          return text.replace(COMPLETION_DELIMITER, "").trim();
        },
      };
    }),
  },
) {}

/**
 * Production layer
 */
export const CompletionDetectorLive = CompletionDetector.Default;
