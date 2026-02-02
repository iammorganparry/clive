---
name: xstate
description: |
  Expert guidance on XState v5 state machines, statecharts, and the actor model for JavaScript/TypeScript applications. Use when: (1) Creating or modifying state machines, (2) Working with actors, spawning, or invoking, (3) Integrating XState with React via @xstate/react hooks, (4) Implementing parallel states, guards, actions, or delayed transitions, (5) TypeScript typing for machines, (6) Testing state machines, (7) Debugging XState issues, (8) Questions about XState patterns or best practices.
---

# XState v5 Expert Guide

XState is a state management and orchestration library using finite state machines, statecharts, and the actor model.

**Requirements**: TypeScript 5.0+, `strictNullChecks: true` in tsconfig.json

## Quick Reference

```typescript
import { setup, assign, createActor, fromPromise } from "xstate";

const machine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: "INC" } | { type: "DEC" } | { type: "SET"; value: number },
  },
  actions: {
    log: ({ context }) => console.log(context.count),
  },
  guards: {
    isPositive: ({ context }) => context.count > 0,
  },
}).createMachine({
  id: "counter",
  initial: "active",
  context: { count: 0 },
  states: {
    active: {
      on: {
        INC: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        DEC: { guard: "isPositive", actions: assign({ count: ({ context }) => context.count - 1 }) },
        SET: { actions: assign({ count: ({ event }) => event.value }) },
      },
    },
  },
});

const actor = createActor(machine);
actor.subscribe((snapshot) => console.log(snapshot.value, snapshot.context));
actor.start();
actor.send({ type: "INC" });
```

## Core Patterns

### Machine Definition with setup()

Always use `setup()` for type safety:

```typescript
const machine = setup({
  types: {
    context: {} as { user: User | null; error: string | null },
    events: {} as
      | { type: "FETCH" }
      | { type: "SUCCESS"; data: User }
      | { type: "ERROR"; message: string },
    input: {} as { userId: string },
  },
  actions: {
    setUser: assign({ user: ({ event }) => event.data, error: null }),
    setError: assign({ error: ({ event }) => event.message, user: null }),
  },
  actors: {
    fetchUser: fromPromise(async ({ input }: { input: { userId: string } }) => {
      const res = await fetch(`/api/users/${input.userId}`);
      return res.json();
    }),
  },
  guards: {
    hasUser: ({ context }) => context.user !== null,
  },
}).createMachine({
  id: "userLoader",
  initial: "idle",
  context: ({ input }) => ({ user: null, error: null, userId: input.userId }),
  states: {
    idle: { on: { FETCH: "loading" } },
    loading: {
      invoke: {
        src: "fetchUser",
        input: ({ context }) => ({ userId: context.userId }),
        onDone: { target: "success", actions: "setUser" },
        onError: { target: "error", actions: "setError" },
      },
    },
    success: { on: { FETCH: "loading" } },
    error: { on: { FETCH: "loading" } },
  },
});
```

### Parallel States

Use `type: "parallel"` for independent regions active simultaneously:

```typescript
const machine = setup({}).createMachine({
  id: "player",
  type: "parallel",
  states: {
    playback: {
      initial: "paused",
      states: {
        paused: { on: { PLAY: "playing" } },
        playing: { on: { PAUSE: "paused" } },
      },
    },
    volume: {
      initial: "normal",
      states: {
        normal: { on: { MUTE: "muted" } },
        muted: { on: { UNMUTE: "normal" } },
      },
    },
  },
});
// State value: { playback: "paused", volume: "normal" }
```

### Invoking Actors

Actors start on state entry, stop on exit:

```typescript
states: {
  loading: {
    invoke: {
      id: "loader",
      src: "fetchData",
      input: ({ context }) => ({ id: context.id }),
      onDone: { target: "success", actions: assign({ data: ({ event }) => event.output }) },
      onError: { target: "error", actions: assign({ error: ({ event }) => event.error }) },
    },
  },
}
```

### Spawning Actors

For dynamic actors persisting across states:

```typescript
import { spawnChild, stopChild } from "xstate";

// Preferred: spawnChild (no context storage needed)
entry: spawnChild(childMachine, { id: "child" }),
on: { STOP: { actions: stopChild("child") } },

// Alternative: spawn with context reference
entry: assign({ childRef: ({ spawn }) => spawn(childMachine, { id: "child" }) }),
on: { STOP: { actions: [stopChild("child"), assign({ childRef: undefined })] } },
```

### Delayed Transitions

```typescript
const machine = setup({
  delays: {
    timeout: 5000,
    dynamicDelay: ({ context }) => context.retryCount * 1000,
  },
}).createMachine({
  states: {
    waiting: {
      after: {
        timeout: { target: "timedOut" },
      },
    },
    retrying: {
      after: {
        dynamicDelay: { target: "waiting" },
      },
    },
  },
});
```

### Guards (Conditional Transitions)

```typescript
import { and, or, not } from "xstate";

const machine = setup({
  guards: {
    isValid: ({ context }) => context.value.length > 0,
    isAdmin: ({ context }) => context.role === "admin",
    hasPermission: (_, params: { permission: string }) => checkPermission(params.permission),
  },
}).createMachine({
  on: {
    SUBMIT: [
      { guard: and(["isValid", "isAdmin"]), target: "adminSubmit" },
      { guard: "isValid", target: "userSubmit" },
      { target: "invalid" }, // Default fallback
    ],
    DELETE: {
      guard: { type: "hasPermission", params: { permission: "delete" } },
      target: "deleted",
    },
  },
});
```

### Actions

```typescript
import { assign, raise, sendTo, log, enqueueActions } from "xstate";

const machine = setup({
  actions: {
    // Update context
    increment: assign({ count: ({ context }) => context.count + 1 }),

    // Log
    logCount: log(({ context }) => `Count: ${context.count}`),

    // Raise internal event
    notifyComplete: raise({ type: "COMPLETE" }),

    // Send to child actor
    tellChild: sendTo("childId", { type: "PARENT_EVENT" }),

    // Conditional actions
    conditionalActions: enqueueActions(({ enqueue, check }) => {
      enqueue.assign({ timestamp: Date.now() });
      if (check({ type: "isAdmin" })) {
        enqueue("notifyAdmin");
      }
    }),
  },
}).createMachine({ /* ... */ });
```

## React Integration (@xstate/react)

### useActor / useMachine

```typescript
import { useMachine, useActor } from "@xstate/react";

function Counter() {
  const [snapshot, send, actorRef] = useMachine(counterMachine);
  // or: const [snapshot, send, actorRef] = useActor(counterMachine);

  return (
    <div>
      <p>Count: {snapshot.context.count}</p>
      <p>State: {snapshot.value}</p>
      <button onClick={() => send({ type: "INC" })}>+</button>
    </div>
  );
}
```

### useActorRef + useSelector (Performance)

Avoid re-renders on every state change:

```typescript
import { useActorRef, useSelector } from "@xstate/react";

function Counter() {
  const actorRef = useActorRef(counterMachine);
  const count = useSelector(actorRef, (snapshot) => snapshot.context.count);
  const isActive = useSelector(actorRef, (snapshot) => snapshot.matches("active"));

  return <p>Count: {count}, Active: {isActive}</p>;
}
```

### createActorContext (Global State)

```typescript
import { createActorContext } from "@xstate/react";

const CounterContext = createActorContext(counterMachine);

function App() {
  return (
    <CounterContext.Provider>
      <Counter />
    </CounterContext.Provider>
  );
}

function Counter() {
  const count = CounterContext.useSelector((s) => s.context.count);
  const actorRef = CounterContext.useActorRef();
  return <button onClick={() => actorRef.send({ type: "INC" })}>{count}</button>;
}
```

### State Matching

```typescript
// For simple states
if (snapshot.value === "loading") { /* ... */ }

// For nested/parallel states - use matches()
if (snapshot.matches("active")) { /* ... */ }
if (snapshot.matches({ player: "playing" })) { /* ... */ }
if (snapshot.matches({ player: { mode: "shuffle" } })) { /* ... */ }
```

## Testing

```typescript
import { createActor } from "xstate";
import { describe, it, expect, vi } from "vitest";

describe("toggleMachine", () => {
  it("transitions on events", () => {
    const actor = createActor(toggleMachine).start();

    expect(actor.getSnapshot().value).toBe("inactive");
    actor.send({ type: "TOGGLE" });
    expect(actor.getSnapshot().value).toBe("active");
  });

  it("updates context", () => {
    const actor = createActor(counterMachine).start();

    actor.send({ type: "INC" });
    expect(actor.getSnapshot().context.count).toBe(1);
  });
});

// Mocking actions
const mockLog = vi.fn();
const testMachine = machine.provide({
  actions: { log: mockLog },
});
const actor = createActor(testMachine).start();
actor.send({ type: "LOG" });
expect(mockLog).toHaveBeenCalled();
```

## Common Patterns

### Input for Initial Context

```typescript
const machine = setup({
  types: {
    input: {} as { initialCount: number },
    context: {} as { count: number },
  },
}).createMachine({
  context: ({ input }) => ({ count: input.initialCount }),
});

const actor = createActor(machine, { input: { initialCount: 10 } });
```

### Self-Transitions (Update Context Without State Change)

```typescript
on: {
  UPDATE: {
    // No target = stay in current state
    actions: assign({ value: ({ event }) => event.value }),
  },
}
```

### Re-entering States

```typescript
on: {
  RESET: {
    target: "idle",
    reenter: true, // Forces exit/entry actions to run
  },
}
```

### Wildcard Events

```typescript
on: {
  "user.*": { actions: "logUserEvent" }, // Matches user.login, user.logout, etc.
  "*": { actions: "logUnhandled" }, // Catch-all (lowest priority)
}
```

## Anti-Patterns to Avoid

1. **Mutating context directly** - Always use `assign()`
2. **Calling built-in actions inside functions** - Use them directly: `actions: assign({...})` not `actions: () => assign({...})`
3. **String state comparisons for nested states** - Use `snapshot.matches()` instead
4. **Storing functions in context** - Keep context serializable
5. **Using `useEffect` to sync with XState** - Use machine actions instead

## Type Helpers

```typescript
import type { ActorRefFrom, SnapshotFrom, EventFromLogic } from "xstate";

type MyActorRef = ActorRefFrom<typeof myMachine>;
type MySnapshot = SnapshotFrom<typeof myMachine>;
type MyEvents = EventFromLogic<typeof myMachine>;
```

## Additional Resources

See [references/react-patterns.md](references/react-patterns.md) for advanced React integration patterns.
See [references/actor-patterns.md](references/actor-patterns.md) for actor communication and hierarchy patterns.
