import { setup, assign } from "xstate";
import type {
  ProposedTest,
  TestExecutionStatus,
} from "../../../../services/ai-agent/types.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import { createPlanTestsActor } from "../actors/plan-tests-actor.js";

// Typed message interface for approval messages
interface ApprovalMessage {
  subscriptionId: string;
  type: "approval";
  toolCallId: string;
  data: "Yes, confirmed." | "No, denied.";
}

function sendApproval(vscode: VSCodeAPI, message: ApprovalMessage): void {
  vscode.postMessage(message);
}

export interface FileTestContext {
  filePath: string;
  vscode: VSCodeAPI;
  proposals: ProposedTest[];
  testStatuses: Map<string, TestExecutionStatus>;
  testErrors: Map<string, string>;
  testFilePaths: Map<string, string>;
  subscriptionId: string | null;
  testIdToToolCallId: Map<string, string>;
  logs: string[];
  statusMessage: string;
  error: string | null;
  planFilePath: string | null;
  streamingContent: string;
}

export type FileTestEvent =
  | { type: "CREATE_TEST" }
  | { type: "PROGRESS"; message: string }
  | {
      type: "PROPOSAL_RECEIVED";
      proposal: ProposedTest;
      toolCallId: string;
      subscriptionId: string;
    }
  | {
      type: "PLAN_FILE_CREATED";
      planFilePath: string;
      proposalId: string;
      subscriptionId: string;
    }
  | { type: "CONTENT_STREAMED"; content: string }
  | { type: "APPROVE"; testId: string }
  | { type: "REJECT"; testId: string }
  | { type: "EXECUTION_COMPLETE"; testId: string; filePath?: string }
  | { type: "EXECUTION_ERROR"; testId: string; error: string }
  | {
      type: "SUBSCRIPTION_COMPLETE";
      executions?: Array<{ testId: string; filePath?: string }>;
    }
  | { type: "SUBSCRIPTION_ERROR"; error: string }
  | { type: "CANCEL" }
  | { type: "RESET" };

export interface FileTestInput {
  filePath: string;
  vscode: VSCodeAPI;
}

export const fileTestMachine = setup({
  types: {
    context: {} as FileTestContext,
    events: {} as FileTestEvent,
    input: {} as FileTestInput,
  },
  actors: {
    planTestsActor: createPlanTestsActor,
  },
  actions: {
    addLog: assign(({ context, event }) => {
      if (event.type !== "PROGRESS") return {};
      const newMessage = event.message;
      const logs = [...context.logs];

      // Extract base message by removing " (N)..." suffix and just "..."
      const getBaseMessage = (msg: string) => {
        return msg.replace(/\s*\(\d+\)\s*\.\.\.?$/, "").replace(/\.\.\.?$/, "");
      };

      // Check if last log is the same type (consolidate duplicates)
      if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        const lastBase = getBaseMessage(lastLog);
        const newBase = getBaseMessage(newMessage);

        if (lastBase === newBase && lastBase.length > 0) {
          // Extract count from last log or default to 1
          const countMatch = lastLog.match(/\((\d+)\)/);
          const currentCount = countMatch ? parseInt(countMatch[1], 10) : 1;
          // Replace last log with updated count
          logs[logs.length - 1] = `${lastBase} (${currentCount + 1})...`;
          return { logs, statusMessage: newMessage || context.statusMessage };
        }
      }

      return {
        logs: [...logs, newMessage],
        statusMessage: newMessage || context.statusMessage,
      };
    }),
    addProposal: assign(({ context, event }) => {
      if (event.type !== "PROPOSAL_RECEIVED") return {};
      const nextStatuses = new Map(context.testStatuses);
      nextStatuses.set(event.proposal.id, "pending");
      const nextToolCallId = new Map(context.testIdToToolCallId);
      nextToolCallId.set(event.proposal.id, event.toolCallId);
      return {
        proposals: [...context.proposals, event.proposal],
        testStatuses: nextStatuses,
        testIdToToolCallId: nextToolCallId,
        subscriptionId: event.subscriptionId || context.subscriptionId,
      };
    }),
    setError: assign(({ event }) => {
      if (event.type !== "SUBSCRIPTION_ERROR") return {};
      return { error: event.error };
    }),
    clearError: assign({ error: () => null }),
    approveTest: assign(({ context, event }) => {
      if (event.type !== "APPROVE") return {};
      const next = new Map(context.testStatuses);
      next.set(event.testId, "accepted");
      return { testStatuses: next };
    }),
    rejectTest: assign(({ context, event }) => {
      if (event.type !== "REJECT") return {};
      const nextStatuses = new Map(context.testStatuses);
      nextStatuses.set(event.testId, "rejected");
      const nextToolCallId = new Map(context.testIdToToolCallId);
      nextToolCallId.delete(event.testId);
      return {
        testStatuses: nextStatuses,
        testIdToToolCallId: nextToolCallId,
      };
    }),
    markExecutionComplete: assign(({ context, event }) => {
      if (event.type !== "EXECUTION_COMPLETE" || !event.filePath) return {};
      const nextStatuses = new Map(context.testStatuses);
      nextStatuses.set(event.testId, "completed");
      const nextFilePaths = new Map(context.testFilePaths);
      nextFilePaths.set(event.testId, event.filePath);
      return {
        testStatuses: nextStatuses,
        testFilePaths: nextFilePaths,
        logs: [...context.logs, `Test file written: ${event.filePath}`],
        statusMessage: `Test created: ${event.filePath}`,
      };
    }),
    markExecutionError: assign(({ context, event }) => {
      if (event.type !== "EXECUTION_ERROR") return {};
      const nextStatuses = new Map(context.testStatuses);
      nextStatuses.set(event.testId, "error");
      const nextErrors = new Map(context.testErrors);
      nextErrors.set(event.testId, event.error);
      return {
        testStatuses: nextStatuses,
        testErrors: nextErrors,
      };
    }),
    setPlanFile: assign(({ context, event }) => {
      if (event.type !== "PLAN_FILE_CREATED") return {};
      return {
        planFilePath: event.planFilePath,
        subscriptionId: event.subscriptionId || context.subscriptionId,
      };
    }),
    appendStreamingContent: assign(({ context, event }) => {
      if (event.type !== "CONTENT_STREAMED") return {};
      return {
        streamingContent: context.streamingContent + event.content,
        // Don't add streaming content to logs - only PROGRESS events should add to logs
      };
    }),
    reset: assign({
      proposals: () => [],
      testStatuses: () => new Map(),
      testErrors: () => new Map(),
      testFilePaths: () => new Map(),
      subscriptionId: () => null,
      testIdToToolCallId: () => new Map(),
      logs: () => [],
      statusMessage: () => "",
      error: () => null,
      planFilePath: () => null,
      streamingContent: () => "",
    }),
  },
}).createMachine({
  id: "fileTest",
  initial: "idle",
  context: ({ input }) => ({
    filePath: input.filePath,
    vscode: input.vscode,
    proposals: [],
    testStatuses: new Map(),
    testErrors: new Map(),
    testFilePaths: new Map(),
    subscriptionId: null,
    testIdToToolCallId: new Map(),
    logs: [],
    statusMessage: "",
    error: null,
    planFilePath: null,
    streamingContent: "",
  }),
  states: {
    idle: {
      on: {
        CREATE_TEST: {
          target: "planningPhase",
          actions: assign({
            logs: () => ["Planning test..."],
            statusMessage: () => "Planning test...",
            error: () => null,
          }),
        },
      },
    },
    planningPhase: {
      entry: "clearError",
      invoke: {
        id: "planTests",
        src: "planTestsActor",
        input: ({ context }) => ({
          filePath: context.filePath,
          vscode: context.vscode,
        }),
      },
      initial: "planning",
      states: {
        planning: {
          on: {
            PLAN_FILE_CREATED: {
              target: "streaming",
              actions: ["setPlanFile"],
            },
            PROPOSAL_RECEIVED: {
              target: "awaitingApproval",
              actions: [
                "addProposal",
                assign({
                  logs: ({ context }) => [
                    ...context.logs,
                    "Test plan created - awaiting approval",
                  ],
                }),
              ],
            },
          },
        },
        streaming: {
          on: {
            CONTENT_STREAMED: {
              actions: ["appendStreamingContent"],
            },
            PROPOSAL_RECEIVED: {
              target: "awaitingApproval",
              actions: [
                "addProposal",
                assign({
                  logs: ({ context }) => [
                    ...context.logs,
                    "Test plan created - awaiting approval",
                  ],
                }),
              ],
            },
          },
        },
        awaitingApproval: {
          on: {
            PROPOSAL_RECEIVED: {
              actions: "addProposal",
            },
            APPROVE: {
              target: "generating",
              actions: [
                "approveTest",
                ({ context, event }) => {
                  // Send approval to backend
                  if (event.type !== "APPROVE") return;
                  const toolCallId = context.testIdToToolCallId.get(
                    event.testId,
                  );
                  if (toolCallId && context.subscriptionId) {
                    sendApproval(context.vscode, {
                      subscriptionId: context.subscriptionId,
                      type: "approval",
                      toolCallId,
                      data: "Yes, confirmed.",
                    });
                  }
                },
              ],
            },
            REJECT: {
              target: "idle",
              actions: [
                "rejectTest",
                ({ context, event }) => {
                  // Send rejection to backend
                  if (event.type !== "REJECT") return;
                  const toolCallId = context.testIdToToolCallId.get(
                    event.testId,
                  );
                  if (toolCallId && context.subscriptionId) {
                    sendApproval(context.vscode, {
                      subscriptionId: context.subscriptionId,
                      type: "approval",
                      toolCallId,
                      data: "No, denied.",
                    });
                  }
                },
              ],
            },
          },
        },
      },
      on: {
        PROGRESS: {
          actions: "addLog",
        },
        SUBSCRIPTION_COMPLETE: {
          target: "generating",
        },
        SUBSCRIPTION_ERROR: {
          target: "error",
          actions: "setError",
        },
        CANCEL: {
          target: "idle",
          actions: "reset",
        },
      },
    },
    generating: {
      on: {
        PROGRESS: {
          actions: "addLog",
        },
        EXECUTION_COMPLETE: {
          actions: "markExecutionComplete",
        },
        EXECUTION_ERROR: {
          actions: "markExecutionError",
        },
        SUBSCRIPTION_COMPLETE: [
          {
            guard: ({ context }) => {
              // Check if all accepted tests are completed
              const acceptedTests = Array.from(
                context.testStatuses.entries(),
              ).filter(([, status]) => status === "accepted");
              const completedTests = Array.from(
                context.testStatuses.entries(),
              ).filter(([, status]) => status === "completed");
              return acceptedTests.length === completedTests.length;
            },
            target: "completed",
          },
          {
            target: "generating",
          },
        ],
        CANCEL: {
          target: "idle",
          actions: "reset",
        },
      },
    },
    completed: {
      on: {
        RESET: {
          target: "idle",
          actions: "reset",
        },
        CREATE_TEST: {
          target: "planningPhase",
          actions: assign({
            logs: () => ["Planning test..."],
            statusMessage: () => "Planning test...",
            error: () => null,
          }),
        },
      },
    },
    error: {
      on: {
        RESET: {
          target: "idle",
          actions: "reset",
        },
        CREATE_TEST: {
          target: "planningPhase",
          actions: assign({
            logs: () => ["Planning test..."],
            statusMessage: () => "Planning test...",
            error: () => null,
          }),
        },
      },
    },
  },
});

export type FileTestMachine = typeof fileTestMachine;
