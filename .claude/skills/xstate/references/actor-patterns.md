# XState Actor Patterns

Advanced patterns for actor communication, hierarchies, and composition.

## Table of Contents

1. [Actor Types Overview](#actor-types-overview)
2. [Parent-Child Communication](#parent-child-communication)
3. [Sibling Communication](#sibling-communication)
4. [Actor Hierarchies](#actor-hierarchies)
5. [Dynamic Actor Collections](#dynamic-actor-collections)
6. [Actor Persistence](#actor-persistence)
7. [System-Level Actors](#system-level-actors)

## Actor Types Overview

### Promise Actors

For one-shot async operations:

```typescript
import { fromPromise } from "xstate";

const fetchUserActor = fromPromise(async ({ input }: { input: { userId: string } }) => {
  const response = await fetch(`/api/users/${input.userId}`);
  if (!response.ok) throw new Error("Failed to fetch");
  return response.json();
});

// Usage in machine
invoke: {
  src: fetchUserActor,
  input: ({ context }) => ({ userId: context.userId }),
  onDone: { actions: assign({ user: ({ event }) => event.output }) },
  onError: { actions: assign({ error: ({ event }) => event.error }) },
}
```

### Callback Actors

For bidirectional communication and long-running processes:

```typescript
import { fromCallback } from "xstate";

const websocketActor = fromCallback<
  { type: "MESSAGE"; data: string } | { type: "CLOSE" },
  { url: string }
>(({ sendBack, receive, input }) => {
  const ws = new WebSocket(input.url);

  ws.onmessage = (event) => {
    sendBack({ type: "MESSAGE", data: event.data });
  };

  ws.onclose = () => {
    sendBack({ type: "CLOSE" });
  };

  // Receive events from parent
  receive((event) => {
    if (event.type === "SEND") {
      ws.send(event.data);
    }
  });

  // Cleanup
  return () => ws.close();
});

// Usage
invoke: {
  id: "websocket",
  src: websocketActor,
  input: { url: "wss://example.com/ws" },
},
on: {
  MESSAGE: { actions: "handleMessage" },
  SEND_MESSAGE: {
    actions: sendTo("websocket", ({ event }) => ({ type: "SEND", data: event.data })),
  },
}
```

### Observable Actors

For streaming data:

```typescript
import { fromObservable } from "xstate";
import { interval } from "rxjs";
import { map } from "rxjs/operators";

const timerActor = fromObservable(({ input }: { input: { interval: number } }) =>
  interval(input.interval).pipe(map((count) => ({ count })))
);

// Usage
invoke: {
  src: timerActor,
  input: { interval: 1000 },
  onSnapshot: {
    actions: assign({ count: ({ event }) => event.snapshot.context.count }),
  },
}
```

### Transition Actors

For reducer-like state management:

```typescript
import { fromTransition } from "xstate";

const counterActor = fromTransition(
  (state, event: { type: "INC" } | { type: "DEC" } | { type: "SET"; value: number }) => {
    switch (event.type) {
      case "INC":
        return { count: state.count + 1 };
      case "DEC":
        return { count: state.count - 1 };
      case "SET":
        return { count: event.value };
      default:
        return state;
    }
  },
  { count: 0 }
);
```

## Parent-Child Communication

### Child Sending to Parent

```typescript
import { sendParent } from "xstate";

const childMachine = setup({
  actions: {
    notifyParent: sendParent({ type: "CHILD_COMPLETE", result: "success" }),
  },
}).createMachine({
  states: {
    working: {
      on: {
        DONE: { target: "complete", actions: "notifyParent" },
      },
    },
    complete: { type: "final" },
  },
});

// Parent receives via onDone or regular event handler
const parentMachine = setup({}).createMachine({
  states: {
    active: {
      invoke: {
        src: childMachine,
        onDone: "finished",
      },
      on: {
        CHILD_COMPLETE: { actions: "handleChildComplete" },
      },
    },
  },
});
```

### Parent Sending to Child (via sendTo)

```typescript
import { sendTo } from "xstate";

const parentMachine = setup({
  actions: {
    instructChild: sendTo("childActor", { type: "DO_WORK" }),
    sendDataToChild: sendTo("childActor", ({ context }) => ({
      type: "UPDATE",
      data: context.data,
    })),
  },
}).createMachine({
  states: {
    active: {
      invoke: {
        id: "childActor",
        src: childMachine,
      },
      on: {
        START_CHILD: { actions: "instructChild" },
        UPDATE_CHILD: { actions: "sendDataToChild" },
      },
    },
  },
});
```

### Input-Based Communication

Pass data to child via input:

```typescript
const childMachine = setup({
  types: {
    input: {} as { parentData: string; onComplete: (result: string) => void },
  },
}).createMachine({
  context: ({ input }) => ({
    data: input.parentData,
    callback: input.onComplete,
  }),
  // ...
});

// Parent
invoke: {
  src: childMachine,
  input: ({ context, self }) => ({
    parentData: context.someData,
    onComplete: (result) => self.send({ type: "CHILD_RESULT", result }),
  }),
}
```

## Sibling Communication

### Via Parent Relay

```typescript
const parentMachine = setup({
  actions: {
    relayToSiblingB: sendTo("siblingB", ({ event }) => ({
      type: "FROM_SIBLING_A",
      data: event.data,
    })),
  },
}).createMachine({
  type: "parallel",
  states: {
    regionA: {
      invoke: { id: "siblingA", src: siblingAMachine },
      on: {
        SIBLING_A_EVENT: { actions: "relayToSiblingB" },
      },
    },
    regionB: {
      invoke: { id: "siblingB", src: siblingBMachine },
    },
  },
});
```

### Via System-Level Actor Registry

```typescript
const siblingAMachine = setup({
  actions: {
    notifySiblingB: sendTo(
      ({ system }) => system.get("siblingB"),
      { type: "NOTIFICATION" }
    ),
  },
}).createMachine({
  // ...
});

// Register actors at system level
const parentMachine = setup({}).createMachine({
  invoke: [
    { id: "siblingA", src: siblingAMachine, systemId: "siblingA" },
    { id: "siblingB", src: siblingBMachine, systemId: "siblingB" },
  ],
});
```

## Actor Hierarchies

### Multi-Level Hierarchy

```typescript
// Grandchild
const taskMachine = setup({}).createMachine({
  id: "task",
  initial: "pending",
  states: {
    pending: { on: { START: "running" } },
    running: { on: { COMPLETE: "done" } },
    done: { type: "final" },
  },
});

// Child - manages multiple tasks
const workerMachine = setup({
  types: {
    context: {} as { tasks: ActorRefFrom<typeof taskMachine>[] },
  },
}).createMachine({
  context: { tasks: [] },
  entry: assign({
    tasks: ({ spawn }) => [
      spawn(taskMachine, { id: "task-1" }),
      spawn(taskMachine, { id: "task-2" }),
    ],
  }),
  on: {
    START_ALL: {
      actions: ({ context }) => {
        context.tasks.forEach((task) => task.send({ type: "START" }));
      },
    },
  },
});

// Parent - orchestrates workers
const supervisorMachine = setup({}).createMachine({
  invoke: [
    { id: "worker-1", src: workerMachine },
    { id: "worker-2", src: workerMachine },
  ],
});
```

## Dynamic Actor Collections

### Managing a Dynamic List of Actors

```typescript
const todoListMachine = setup({
  types: {
    context: {} as {
      todos: Map<string, ActorRefFrom<typeof todoMachine>>;
    },
    events: {} as
      | { type: "ADD_TODO"; id: string; text: string }
      | { type: "REMOVE_TODO"; id: string }
      | { type: "TODO_COMPLETED"; id: string },
  },
  actions: {
    spawnTodo: assign({
      todos: ({ context, spawn, event }) => {
        const newTodos = new Map(context.todos);
        newTodos.set(
          event.id,
          spawn(todoMachine, {
            id: `todo-${event.id}`,
            input: { id: event.id, text: event.text },
          })
        );
        return newTodos;
      },
    }),
    removeTodo: assign({
      todos: ({ context, event }) => {
        const newTodos = new Map(context.todos);
        const actor = newTodos.get(event.id);
        if (actor) {
          actor.stop();
          newTodos.delete(event.id);
        }
        return newTodos;
      },
    }),
  },
}).createMachine({
  context: { todos: new Map() },
  on: {
    ADD_TODO: { actions: "spawnTodo" },
    REMOVE_TODO: { actions: "removeTodo" },
    TODO_COMPLETED: { actions: "removeTodo" },
  },
});
```

### Actor Pool Pattern

```typescript
const workerPoolMachine = setup({
  types: {
    context: {} as {
      workers: ActorRefFrom<typeof workerMachine>[];
      queue: Job[];
      activeJobs: Map<string, string>; // jobId -> workerId
    },
  },
}).createMachine({
  context: ({ spawn }) => ({
    workers: Array.from({ length: 4 }, (_, i) =>
      spawn(workerMachine, { id: `worker-${i}` })
    ),
    queue: [],
    activeJobs: new Map(),
  }),
  on: {
    SUBMIT_JOB: {
      actions: enqueueActions(({ enqueue, context, event }) => {
        const freeWorker = context.workers.find(
          (w) => !Array.from(context.activeJobs.values()).includes(w.id)
        );

        if (freeWorker) {
          enqueue.sendTo(freeWorker, { type: "PROCESS", job: event.job });
          enqueue.assign({
            activeJobs: new Map(context.activeJobs).set(event.job.id, freeWorker.id),
          });
        } else {
          enqueue.assign({ queue: [...context.queue, event.job] });
        }
      }),
    },
    WORKER_DONE: {
      actions: enqueueActions(({ enqueue, context, event }) => {
        enqueue.assign({
          activeJobs: (() => {
            const m = new Map(context.activeJobs);
            m.delete(event.jobId);
            return m;
          })(),
        });

        if (context.queue.length > 0) {
          const [nextJob, ...rest] = context.queue;
          const worker = context.workers.find((w) => w.id === event.workerId);
          if (worker && nextJob) {
            enqueue.sendTo(worker, { type: "PROCESS", job: nextJob });
            enqueue.assign({
              queue: rest,
              activeJobs: new Map(context.activeJobs).set(nextJob.id, worker.id),
            });
          }
        }
      }),
    },
  },
});
```

## Actor Persistence

### Persisting Actor State

```typescript
import { createActor } from "xstate";

// Save state
function persistActor(actor: AnyActorRef) {
  const snapshot = actor.getPersistedSnapshot();
  localStorage.setItem("actorState", JSON.stringify(snapshot));
}

// Restore state
function restoreActor(machine: AnyStateMachine) {
  const saved = localStorage.getItem("actorState");
  const snapshot = saved ? JSON.parse(saved) : undefined;

  return createActor(machine, { snapshot }).start();
}

// Auto-persist on changes
const actor = createActor(myMachine).start();
actor.subscribe({
  next: () => persistActor(actor),
});
```

### Selective Persistence

```typescript
// Only persist certain context properties
function getPersistedContext(snapshot: SnapshotFrom<typeof myMachine>) {
  const { user, preferences } = snapshot.context;
  return { user, preferences }; // Exclude transient data
}

function hydrateContext(persisted: Partial<MyContext>): MyContext {
  return {
    ...defaultContext,
    ...persisted,
    // Reset transient properties
    isLoading: false,
    error: null,
  };
}
```

## System-Level Actors

### Global Actor Registry

```typescript
import { createActor } from "xstate";

// Create system with global actors
const system = createActor(rootMachine).start();

// Access global actors from anywhere
const authActor = system.system.get("auth");
const notificationActor = system.system.get("notifications");

// Machine with systemId for global registration
const appMachine = setup({}).createMachine({
  invoke: [
    { id: "auth", src: authMachine, systemId: "auth" },
    { id: "notifications", src: notificationMachine, systemId: "notifications" },
    { id: "router", src: routerMachine, systemId: "router" },
  ],
});
```

### Cross-Actor Event Bus

```typescript
const eventBusMachine = fromCallback(({ receive, sendBack }) => {
  const subscribers = new Map<string, Set<(event: AnyEventObject) => void>>();

  receive((event) => {
    if (event.type === "SUBSCRIBE") {
      const eventType = event.eventType;
      if (!subscribers.has(eventType)) {
        subscribers.set(eventType, new Set());
      }
      subscribers.get(eventType)!.add(event.callback);
    } else if (event.type === "PUBLISH") {
      const handlers = subscribers.get(event.eventType);
      handlers?.forEach((handler) => handler(event.payload));
    }
  });
});

// Usage
const featureMachine = setup({
  actions: {
    subscribeToAuth: sendTo(
      ({ system }) => system.get("eventBus"),
      ({ self }) => ({
        type: "SUBSCRIBE",
        eventType: "AUTH_CHANGED",
        callback: (payload: { user: User }) => self.send({ type: "USER_UPDATED", user: payload.user }),
      })
    ),
    publishEvent: sendTo(
      ({ system }) => system.get("eventBus"),
      { type: "PUBLISH", eventType: "FEATURE_ENABLED", payload: { feature: "dark-mode" } }
    ),
  },
}).createMachine({
  entry: "subscribeToAuth",
  // ...
});
```

### Supervisor Pattern

```typescript
const supervisorMachine = setup({
  types: {
    context: {} as {
      children: Map<string, { ref: ActorRefFrom<typeof workerMachine>; restarts: number }>;
    },
  },
}).createMachine({
  context: { children: new Map() },
  on: {
    SPAWN_WORKER: {
      actions: assign({
        children: ({ context, spawn, event }) => {
          const children = new Map(context.children);
          children.set(event.id, {
            ref: spawn(workerMachine, {
              id: event.id,
              input: event.config,
            }),
            restarts: 0,
          });
          return children;
        },
      }),
    },
    WORKER_CRASHED: {
      actions: enqueueActions(({ enqueue, context, event }) => {
        const child = context.children.get(event.id);
        if (!child) return;

        if (child.restarts < 3) {
          // Restart with exponential backoff
          enqueue.assign({
            children: (() => {
              const children = new Map(context.children);
              children.set(event.id, {
                ref: child.ref, // Will be replaced
                restarts: child.restarts + 1,
              });
              return children;
            })(),
          });
          enqueue({ type: "RESTART_WORKER", id: event.id, delay: 1000 * 2 ** child.restarts });
        } else {
          // Max restarts exceeded - escalate
          enqueue.raise({ type: "WORKER_FAILED_PERMANENTLY", id: event.id });
        }
      }),
    },
  },
});
```
