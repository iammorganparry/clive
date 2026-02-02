# XState React Patterns

Advanced patterns for integrating XState with React applications.

## Table of Contents

1. [Performance Optimization](#performance-optimization)
2. [Form Handling](#form-handling)
3. [Data Fetching](#data-fetching)
4. [Authentication Flows](#authentication-flows)
5. [Modal/Dialog Management](#modaldialog-management)
6. [Optimistic Updates](#optimistic-updates)
7. [Error Boundaries](#error-boundaries)

## Performance Optimization

### Selective Subscriptions with useSelector

```typescript
import { useActorRef, useSelector, shallowEqual } from "@xstate/react";

function UserProfile() {
  const actorRef = useActorRef(userMachine);

  // Only re-render when user object changes (shallow comparison)
  const user = useSelector(actorRef, (s) => s.context.user, shallowEqual);

  // Only re-render when loading state changes
  const isLoading = useSelector(actorRef, (s) => s.matches("loading"));

  // Derived selector - only re-render when computed value changes
  const fullName = useSelector(
    actorRef,
    (s) => `${s.context.user?.firstName} ${s.context.user?.lastName}`
  );

  return <div>{isLoading ? "Loading..." : fullName}</div>;
}
```

### Memoized Selectors

```typescript
import { useMemo } from "react";

function ExpensiveComponent() {
  const actorRef = useActorRef(dataMachine);

  // Memoize selector to prevent recreation on each render
  const selectFilteredItems = useMemo(
    () => (snapshot: SnapshotFrom<typeof dataMachine>) =>
      snapshot.context.items.filter(item => item.active),
    []
  );

  const filteredItems = useSelector(actorRef, selectFilteredItems, shallowEqual);

  return <ItemList items={filteredItems} />;
}
```

### Avoiding Re-renders with useActorRef

```typescript
function ParentComponent() {
  // useActorRef doesn't cause re-renders on state changes
  const actorRef = useActorRef(parentMachine);

  return (
    <div>
      {/* Pass actorRef down, children subscribe selectively */}
      <ChildA actorRef={actorRef} />
      <ChildB actorRef={actorRef} />
    </div>
  );
}

function ChildA({ actorRef }: { actorRef: ActorRefFrom<typeof parentMachine> }) {
  // Only this component re-renders when count changes
  const count = useSelector(actorRef, (s) => s.context.count);
  return <p>Count: {count}</p>;
}

function ChildB({ actorRef }: { actorRef: ActorRefFrom<typeof parentMachine> }) {
  // Only this component re-renders when name changes
  const name = useSelector(actorRef, (s) => s.context.name);
  return <p>Name: {name}</p>;
}
```

## Form Handling

### Form Machine Pattern

```typescript
const formMachine = setup({
  types: {
    context: {} as {
      values: { email: string; password: string };
      errors: { email?: string; password?: string };
      touched: { email: boolean; password: boolean };
    },
    events: {} as
      | { type: "CHANGE"; field: "email" | "password"; value: string }
      | { type: "BLUR"; field: "email" | "password" }
      | { type: "SUBMIT" }
      | { type: "SUBMIT_SUCCESS" }
      | { type: "SUBMIT_ERROR"; errors: Record<string, string> },
  },
  guards: {
    isValid: ({ context }) => {
      const errors = validateForm(context.values);
      return Object.keys(errors).length === 0;
    },
  },
  actions: {
    updateField: assign({
      values: ({ context, event }) => ({
        ...context.values,
        [event.field]: event.value,
      }),
    }),
    touchField: assign({
      touched: ({ context, event }) => ({
        ...context.touched,
        [event.field]: true,
      }),
    }),
    validateField: assign({
      errors: ({ context, event }) => ({
        ...context.errors,
        [event.field]: validateField(event.field, context.values[event.field]),
      }),
    }),
  },
}).createMachine({
  id: "form",
  initial: "editing",
  context: {
    values: { email: "", password: "" },
    errors: {},
    touched: { email: false, password: false },
  },
  states: {
    editing: {
      on: {
        CHANGE: { actions: ["updateField", "validateField"] },
        BLUR: { actions: "touchField" },
        SUBMIT: { guard: "isValid", target: "submitting" },
      },
    },
    submitting: {
      invoke: {
        src: "submitForm",
        input: ({ context }) => context.values,
        onDone: "success",
        onError: { target: "editing", actions: "setServerErrors" },
      },
    },
    success: { type: "final" },
  },
});

// Usage
function LoginForm() {
  const [snapshot, send] = useMachine(formMachine);
  const { values, errors, touched } = snapshot.context;

  return (
    <form onSubmit={(e) => { e.preventDefault(); send({ type: "SUBMIT" }); }}>
      <input
        value={values.email}
        onChange={(e) => send({ type: "CHANGE", field: "email", value: e.target.value })}
        onBlur={() => send({ type: "BLUR", field: "email" })}
      />
      {touched.email && errors.email && <span>{errors.email}</span>}

      <button disabled={snapshot.matches("submitting")}>
        {snapshot.matches("submitting") ? "Submitting..." : "Submit"}
      </button>
    </form>
  );
}
```

## Data Fetching

### Fetch Machine with Retry

```typescript
const fetchMachine = setup({
  types: {
    context: {} as {
      data: Data | null;
      error: Error | null;
      retryCount: number;
    },
    input: {} as { url: string; maxRetries?: number },
  },
  delays: {
    retryDelay: ({ context }) => Math.min(1000 * 2 ** context.retryCount, 30000),
  },
  actors: {
    fetchData: fromPromise(async ({ input }: { input: { url: string } }) => {
      const res = await fetch(input.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }),
  },
}).createMachine({
  id: "fetch",
  initial: "idle",
  context: ({ input }) => ({
    data: null,
    error: null,
    retryCount: 0,
    url: input.url,
    maxRetries: input.maxRetries ?? 3,
  }),
  states: {
    idle: {
      on: { FETCH: "loading" },
    },
    loading: {
      invoke: {
        src: "fetchData",
        input: ({ context }) => ({ url: context.url }),
        onDone: {
          target: "success",
          actions: assign({ data: ({ event }) => event.output, error: null }),
        },
        onError: [
          {
            guard: ({ context }) => context.retryCount < context.maxRetries,
            target: "retrying",
            actions: assign({
              error: ({ event }) => event.error,
              retryCount: ({ context }) => context.retryCount + 1,
            }),
          },
          {
            target: "error",
            actions: assign({ error: ({ event }) => event.error }),
          },
        ],
      },
    },
    retrying: {
      after: {
        retryDelay: "loading",
      },
    },
    success: {
      on: { REFETCH: "loading" },
    },
    error: {
      on: { RETRY: { target: "loading", actions: assign({ retryCount: 0 }) } },
    },
  },
});

// Custom hook
function useFetch<T>(url: string) {
  const [snapshot, send] = useMachine(fetchMachine, { input: { url } });

  useEffect(() => {
    send({ type: "FETCH" });
  }, [send]);

  return {
    data: snapshot.context.data as T | null,
    error: snapshot.context.error,
    isLoading: snapshot.matches("loading"),
    isRetrying: snapshot.matches("retrying"),
    retry: () => send({ type: "RETRY" }),
    refetch: () => send({ type: "REFETCH" }),
  };
}
```

## Authentication Flows

### Auth Machine

```typescript
const authMachine = setup({
  types: {
    context: {} as {
      user: User | null;
      error: string | null;
    },
    events: {} as
      | { type: "LOGIN"; credentials: { email: string; password: string } }
      | { type: "LOGOUT" }
      | { type: "REFRESH" },
  },
  actors: {
    checkSession: fromPromise(async () => {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("No session");
      return validateToken(token);
    }),
    login: fromPromise(async ({ input }: { input: { email: string; password: string } }) => {
      const response = await api.login(input);
      localStorage.setItem("token", response.token);
      return response.user;
    }),
  },
}).createMachine({
  id: "auth",
  initial: "checkingSession",
  context: { user: null, error: null },
  states: {
    checkingSession: {
      invoke: {
        src: "checkSession",
        onDone: { target: "authenticated", actions: assign({ user: ({ event }) => event.output }) },
        onError: "unauthenticated",
      },
    },
    unauthenticated: {
      on: {
        LOGIN: "loggingIn",
      },
    },
    loggingIn: {
      invoke: {
        src: "login",
        input: ({ event }) => event.credentials,
        onDone: { target: "authenticated", actions: assign({ user: ({ event }) => event.output }) },
        onError: { target: "unauthenticated", actions: assign({ error: ({ event }) => event.error.message }) },
      },
    },
    authenticated: {
      on: {
        LOGOUT: {
          target: "unauthenticated",
          actions: () => localStorage.removeItem("token"),
        },
      },
    },
  },
});

// Auth Context Provider
const AuthContext = createActorContext(authMachine);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return <AuthContext.Provider>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const isAuthenticated = AuthContext.useSelector((s) => s.matches("authenticated"));
  const user = AuthContext.useSelector((s) => s.context.user);
  const isLoading = AuthContext.useSelector((s) => s.matches("checkingSession") || s.matches("loggingIn"));
  const actorRef = AuthContext.useActorRef();

  return {
    isAuthenticated,
    user,
    isLoading,
    login: (credentials: { email: string; password: string }) =>
      actorRef.send({ type: "LOGIN", credentials }),
    logout: () => actorRef.send({ type: "LOGOUT" }),
  };
}
```

## Modal/Dialog Management

### Modal Machine

```typescript
const modalMachine = setup({
  types: {
    context: {} as {
      isOpen: boolean;
      data: unknown;
      result: unknown;
    },
    events: {} as
      | { type: "OPEN"; data?: unknown }
      | { type: "CLOSE" }
      | { type: "CONFIRM"; result?: unknown }
      | { type: "CANCEL" },
  },
}).createMachine({
  id: "modal",
  initial: "closed",
  context: { isOpen: false, data: null, result: null },
  states: {
    closed: {
      entry: assign({ isOpen: false, data: null }),
      on: {
        OPEN: {
          target: "open",
          actions: assign({ isOpen: true, data: ({ event }) => event.data }),
        },
      },
    },
    open: {
      on: {
        CLOSE: "closed",
        CANCEL: "closed",
        CONFIRM: {
          target: "closed",
          actions: assign({ result: ({ event }) => event.result }),
        },
      },
    },
  },
});

// Hook for imperative modal control
function useModal<TData, TResult>() {
  const [snapshot, send] = useMachine(modalMachine);

  return {
    isOpen: snapshot.context.isOpen,
    data: snapshot.context.data as TData | null,
    open: (data?: TData) => send({ type: "OPEN", data }),
    close: () => send({ type: "CLOSE" }),
    confirm: (result?: TResult) => send({ type: "CONFIRM", result }),
    cancel: () => send({ type: "CANCEL" }),
  };
}
```

## Optimistic Updates

```typescript
const todoMachine = setup({
  types: {
    context: {} as {
      todos: Todo[];
      optimisticTodos: Todo[];
      pendingUpdates: Map<string, Todo>;
    },
  },
  actions: {
    optimisticAdd: assign({
      optimisticTodos: ({ context, event }) => [
        ...context.optimisticTodos,
        { ...event.todo, id: `temp-${Date.now()}`, isPending: true },
      ],
    }),
    commitAdd: assign({
      todos: ({ context, event }) => [...context.todos, event.output],
      optimisticTodos: ({ context, event }) =>
        context.optimisticTodos.filter((t) => t.id !== event.tempId),
    }),
    revertAdd: assign({
      optimisticTodos: ({ context, event }) =>
        context.optimisticTodos.filter((t) => t.id !== event.tempId),
    }),
  },
}).createMachine({
  // ... machine definition
});

// Combined list for rendering
function TodoList() {
  const actorRef = useActorRef(todoMachine);
  const allTodos = useSelector(actorRef, (s) => [
    ...s.context.todos,
    ...s.context.optimisticTodos,
  ]);

  return (
    <ul>
      {allTodos.map((todo) => (
        <li key={todo.id} className={todo.isPending ? "opacity-50" : ""}>
          {todo.text}
        </li>
      ))}
    </ul>
  );
}
```

## Error Boundaries

```typescript
// Error boundary machine for component-level error handling
const errorBoundaryMachine = setup({
  types: {
    context: {} as { error: Error | null; errorInfo: React.ErrorInfo | null },
    events: {} as
      | { type: "ERROR"; error: Error; errorInfo: React.ErrorInfo }
      | { type: "RETRY" }
      | { type: "DISMISS" },
  },
}).createMachine({
  id: "errorBoundary",
  initial: "working",
  context: { error: null, errorInfo: null },
  states: {
    working: {
      on: {
        ERROR: {
          target: "error",
          actions: assign({
            error: ({ event }) => event.error,
            errorInfo: ({ event }) => event.errorInfo,
          }),
        },
      },
    },
    error: {
      on: {
        RETRY: {
          target: "working",
          actions: assign({ error: null, errorInfo: null }),
        },
        DISMISS: {
          target: "working",
          actions: assign({ error: null, errorInfo: null }),
        },
      },
    },
  },
});

// React Error Boundary using XState
class XStateErrorBoundary extends React.Component<{
  children: React.ReactNode;
  fallback: (props: { error: Error; retry: () => void }) => React.ReactNode;
}> {
  actorRef = createActor(errorBoundaryMachine).start();

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.actorRef.send({ type: "ERROR", error, errorInfo });
    this.forceUpdate();
  }

  render() {
    const snapshot = this.actorRef.getSnapshot();
    if (snapshot.matches("error") && snapshot.context.error) {
      return this.props.fallback({
        error: snapshot.context.error,
        retry: () => {
          this.actorRef.send({ type: "RETRY" });
          this.forceUpdate();
        },
      });
    }
    return this.props.children;
  }
}
```
