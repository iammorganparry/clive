/**
 * Per-Chat XState Machine
 *
 * Extracted from useAppState.ts. Each chat tab gets its own instance of this machine
 * to manage CLI execution state, output lines, and question handling independently.
 *
 * States: idle → executing → waiting_for_answer
 */

import { assign, setup } from "xstate";
import type { OutputLine, QuestionData } from "../types";

export interface ChatMachineContext {
  chatId: string;
  outputLines: OutputLine[];
  pendingQuestion: QuestionData | null;
  questionQueue: QuestionData[];
  mode: "none" | "plan" | "build" | "review";
  agentSessionActive: boolean;
}

export type ChatMachineEvent =
  | { type: "EXECUTE"; prompt: string; mode: "plan" | "build" | "review" }
  | { type: "OUTPUT"; line: OutputLine }
  | { type: "QUESTION"; question: QuestionData }
  | { type: "ANSWER"; answers: Record<string, string> }
  | { type: "COMPLETE" }
  | { type: "INTERRUPT" }
  | { type: "EXIT_MODE" }
  | { type: "CLEAR" }
  | { type: "MESSAGE"; content: string }
  | { type: "SET_MODE"; mode: "none" | "plan" | "build" | "review" };

export function createChatMachine(chatId: string) {
  return setup({
    types: {
      context: {} as ChatMachineContext,
      events: {} as ChatMachineEvent,
    },
    actions: {
      updateOutput: assign({
        outputLines: ({ context, event }) => {
          if (event.type !== "OUTPUT") return context.outputLines;
          return [...context.outputLines, event.line];
        },
      }),
      setQuestion: assign({
        pendingQuestion: ({ context, event }) => {
          if (event.type !== "QUESTION") return context.pendingQuestion;

          // Allow a complete question to replace an existing empty one with the
          // same toolUseID (handles streaming parser edge cases)
          if (
            context.pendingQuestion &&
            context.pendingQuestion.toolUseID === event.question.toolUseID &&
            context.pendingQuestion.questions.length === 0 &&
            event.question.questions.length > 0
          ) {
            return event.question;
          }

          return context.pendingQuestion || event.question;
        },
        questionQueue: ({ context, event }) => {
          if (event.type !== "QUESTION") return context.questionQueue;

          // Don't queue if this is replacing the current pending question
          if (
            context.pendingQuestion &&
            context.pendingQuestion.toolUseID === event.question.toolUseID &&
            context.pendingQuestion.questions.length === 0 &&
            event.question.questions.length > 0
          ) {
            return context.questionQueue;
          }

          // If there's already a pending question, add new question to queue
          if (context.pendingQuestion) {
            return [...context.questionQueue, event.question];
          }

          return context.questionQueue;
        },
      }),
      clearQuestion: assign({
        pendingQuestion: ({ context }) => {
          if (context.questionQueue.length > 0) {
            return context.questionQueue[0]!;
          }
          return null;
        },
        questionQueue: ({ context }) => {
          if (context.questionQueue.length > 0) {
            return context.questionQueue.slice(1);
          }
          return [];
        },
      }),
      clearOutput: assign({
        outputLines: [],
      }),
      renderMessage: assign({
        outputLines: ({ context, event }) => {
          if (event.type !== "MESSAGE") return context.outputLines;
          return [
            ...context.outputLines,
            { type: "user" as const, text: event.content },
          ];
        },
      }),
      setMode: assign({
        mode: ({ event }) => {
          if (event.type === "EXECUTE") return event.mode;
          if (event.type === "SET_MODE") return event.mode;
          return "none" as const;
        },
        agentSessionActive: ({ event }) => {
          if (event.type === "SET_MODE") return false;
          return true;
        },
      }),
      clearMode: assign({
        mode: "none" as const,
        agentSessionActive: false,
      }),
      clearQuestionQueue: assign({
        pendingQuestion: null,
        questionQueue: [] as QuestionData[],
      }),
    },
  }).createMachine({
    id: `chat-${chatId}`,
    initial: "idle",
    context: {
      chatId,
      outputLines: [],
      pendingQuestion: null,
      questionQueue: [],
      mode: "none",
      agentSessionActive: false,
    },
    states: {
      idle: {
        on: {
          EXECUTE: {
            target: "executing",
            actions: "setMode",
          },
          QUESTION: {
            target: "waiting_for_answer",
            actions: "setQuestion",
          },
          EXIT_MODE: {
            actions: "clearMode",
          },
          SET_MODE: {
            actions: "setMode",
          },
          CLEAR: {
            actions: "clearOutput",
          },
          OUTPUT: {
            actions: "updateOutput",
          },
        },
      },
      executing: {
        on: {
          OUTPUT: {
            actions: "updateOutput",
          },
          QUESTION: {
            target: "waiting_for_answer",
            actions: "setQuestion",
          },
          COMPLETE: {
            target: "idle",
            actions: "clearQuestionQueue",
          },
          INTERRUPT: {
            target: "idle",
            actions: ["clearMode", "clearQuestionQueue"],
          },
          EXIT_MODE: {
            target: "idle",
            actions: ["clearMode", "clearQuestionQueue"],
          },
          MESSAGE: {
            actions: "renderMessage",
          },
        },
      },
      waiting_for_answer: {
        on: {
          OUTPUT: {
            actions: "updateOutput",
          },
          QUESTION: {
            actions: "setQuestion",
          },
          ANSWER: [
            {
              target: "waiting_for_answer",
              guard: ({ context }) => context.questionQueue.length > 0,
              actions: "clearQuestion",
            },
            {
              target: "executing",
              actions: "clearQuestion",
            },
          ],
          COMPLETE: {
            target: "idle",
            actions: "clearQuestionQueue",
          },
          INTERRUPT: {
            target: "idle",
            actions: ["clearQuestionQueue", "clearMode"],
          },
          EXIT_MODE: {
            target: "idle",
            actions: ["clearQuestionQueue", "clearMode"],
          },
        },
      },
    },
  });
}
