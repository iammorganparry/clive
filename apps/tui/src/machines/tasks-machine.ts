import { assign, fromCallback, setup } from "xstate";
import type { Session, Task } from "../types.js";
import {
  clearBeadsCache,
  getEpicTasks,
  isBeadsAvailable,
} from "../utils/beads.js";

// Status priority for sorting (lower = first)
const STATUS_ORDER: Record<Task["status"], number> = {
  in_progress: 0,
  pending: 1,
  blocked: 2,
  skipped: 3,
  complete: 4,
};

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    const tierA = a.tier ?? 999;
    const tierB = b.tier ?? 999;
    return tierA - tierB;
  });
}

// Machine context
export interface TasksContext {
  session: Session | null;
  tasks: Task[];
  epicName: string | undefined;
  skill: string | undefined;
  category: string | undefined;
  isPolling: boolean;
}

// Machine events
export type TasksEvent =
  | { type: "SET_SESSION"; session: Session | null }
  | { type: "SET_POLLING"; polling: boolean }
  | { type: "POLL_TICK" }
  | { type: "REFRESH" };

// Polling actor - ticks every 5 seconds
const pollingActor = fromCallback<
  { type: "POLL_TICK" },
  { isPolling: boolean }
>(({ sendBack, input }) => {
  if (!input.isPolling) return () => {};

  const timer = setInterval(() => {
    sendBack({ type: "POLL_TICK" });
  }, 5000);

  return () => clearInterval(timer);
});

// Fetch tasks from beads
function fetchTasks(session: Session | null): {
  tasks: Task[];
  epicName: string | undefined;
  skill: string | undefined;
  category: string | undefined;
} {
  if (!session || !isBeadsAvailable()) {
    return {
      tasks: [],
      epicName: session?.name,
      skill: undefined,
      category: undefined,
    };
  }

  // Clear cache to get fresh data
  clearBeadsCache();

  const epicTasks = getEpicTasks(session.epicId);
  const sortedTasks = sortTasks(epicTasks);

  // Extract metadata
  const skills = [...new Set(epicTasks.map((t) => t.skill).filter(Boolean))];
  const categories = [
    ...new Set(epicTasks.map((t) => t.category).filter(Boolean)),
  ];

  return {
    tasks: sortedTasks,
    epicName: session.name,
    skill: skills[0],
    category: categories[0],
  };
}

export const tasksMachine = setup({
  types: {
    context: {} as TasksContext,
    events: {} as TasksEvent,
  },
  actors: {
    polling: pollingActor,
  },
  actions: {
    refreshTasks: assign(({ context }) => fetchTasks(context.session)),
    setSession: assign(({ event }) => {
      if (event.type !== "SET_SESSION") return {};
      const result = fetchTasks(event.session);
      return {
        session: event.session,
        ...result,
      };
    }),
    setPolling: assign(({ event }) => {
      if (event.type !== "SET_POLLING") return {};
      return { isPolling: event.polling };
    }),
  },
}).createMachine({
  id: "tasks",
  initial: "idle",
  context: {
    session: null,
    tasks: [],
    epicName: undefined,
    skill: undefined,
    category: undefined,
    isPolling: false,
  },
  invoke: {
    id: "polling",
    src: "polling",
    input: ({ context }) => ({ isPolling: context.isPolling }),
  },
  on: {
    SET_SESSION: {
      actions: "setSession",
    },
    SET_POLLING: {
      actions: "setPolling",
      // Restart polling actor with new input
      reenter: true,
    },
    POLL_TICK: {
      actions: "refreshTasks",
    },
    REFRESH: {
      actions: "refreshTasks",
    },
  },
  states: {
    idle: {},
  },
});

export type TasksMachine = typeof tasksMachine;
