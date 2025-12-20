import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  useRpcQuery,
  useRpcMutation,
  useRpcSubscription,
  initializeRpcMessageHandler,
} from "../hooks.js";
import type { VSCodeAPI } from "../../services/vscode.js";

// Mock VSCodeAPI
const createMockVscode = (): VSCodeAPI => {
  const postMessage = vi.fn();
  return {
    postMessage,
    getState: vi.fn(),
    setState: vi.fn(),
  };
};

// Wrapper for React Query
const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};

describe("useRpcQuery", () => {
  let mockVscode: VSCodeAPI;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    mockVscode = createMockVscode();
    messageHandler = null;

    // Set up message listener
    window.addEventListener = vi.fn((event, handler) => {
      if (event === "message") {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const simulateResponse = (id: string, data: unknown, success = true) => {
    if (messageHandler) {
      messageHandler(
        new MessageEvent("message", {
          data: {
            id,
            success,
            data: success ? data : undefined,
            error: success ? undefined : { message: "Error message" },
          },
        }),
      );
    }
  };

  it("should send query message and return data", async () => {
    const { result } = renderHook(
      () => useRpcQuery(mockVscode, ["test", "query"], { id: "123" }),
      { wrapper: createWrapper() },
    );

    // Wait for the query to be sent
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
      type: string;
      path: string[];
      input?: unknown;
    };
    expect(messageCall.type).toBe("query");
    expect(messageCall.path).toEqual(["test", "query"]);
    expect(messageCall.input).toEqual({ id: "123" });

    // Simulate response
    simulateResponse(messageCall.id, { result: "success" });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.data).toEqual({ result: "success" });
  });

  it("should handle loading and error states", async () => {
    const { result } = renderHook(
      () => useRpcQuery(mockVscode, ["test", "query"]),
      { wrapper: createWrapper() },
    );

    // Initially loading
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
    };

    // Simulate error response
    simulateResponse(messageCall.id, null, false);

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.error).toBeDefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("should respect enabled option", async () => {
    const { result } = renderHook(
      () =>
        useRpcQuery(mockVscode, ["test", "query"], undefined, {
          enabled: false,
        }),
      { wrapper: createWrapper() },
    );

    // Should not send message when disabled
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.isLoading).toBe(false);

    expect(mockVscode.postMessage).not.toHaveBeenCalled();
  });
});

describe("useRpcMutation", () => {
  let mockVscode: VSCodeAPI;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    mockVscode = createMockVscode();
    messageHandler = null;

    window.addEventListener = vi.fn((event, handler) => {
      if (event === "message") {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const simulateResponse = (id: string, data: unknown, success = true) => {
    if (messageHandler) {
      messageHandler(
        new MessageEvent("message", {
          data: {
            id,
            success,
            data: success ? data : undefined,
            error: success ? undefined : { message: "Error message" },
          },
        }),
      );
    }
  };

  it("should send mutation on mutate call", async () => {
    const { result } = renderHook(
      () => useRpcMutation(mockVscode, ["test", "mutation"]),
      { wrapper: createWrapper() },
    );

    result.current.mutate({ name: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
      type: string;
      path: string[];
      input?: unknown;
    };
    expect(messageCall.type).toBe("mutation");
    expect(messageCall.path).toEqual(["test", "mutation"]);
    expect(messageCall.input).toEqual({ name: "test" });
  });

  it("should track isPending state", async () => {
    const { result } = renderHook(
      () => useRpcMutation(mockVscode, ["test", "mutation"]),
      { wrapper: createWrapper() },
    );

    expect(result.current.isPending).toBe(false);

    result.current.mutate({ name: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.isPending).toBe(true);
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
    };
    simulateResponse(messageCall.id, { success: true });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(result.current.isPending).toBe(false);
  });

  it("should call onSuccess callback", async () => {
    const onSuccess = vi.fn();
    const { result } = renderHook(
      () =>
        useRpcMutation(mockVscode, ["test", "mutation"], {
          onSuccess,
        }),
      { wrapper: createWrapper() },
    );

    result.current.mutate({ name: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
    };
    simulateResponse(messageCall.id, { success: true });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onSuccess).toHaveBeenCalledWith({ success: true });
  });
});

describe("useRpcSubscription", () => {
  let mockVscode: VSCodeAPI;
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    mockVscode = createMockVscode();
    messageHandler = null;

    window.addEventListener = vi.fn((event, handler) => {
      if (event === "message") {
        messageHandler = handler as (event: MessageEvent) => void;
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const simulateSubscriptionUpdate = (
    id: string,
    type: "data" | "complete" | "error",
    data?: unknown,
    error?: { message: string },
  ) => {
    if (messageHandler) {
      messageHandler(
        new MessageEvent("message", {
          data: {
            id,
            type,
            data,
            error,
          },
        }),
      );
    }
  };

  it("should subscribe and receive progress updates", async () => {
    const onData = vi.fn();
    const { result } = renderHook(
      () =>
        useRpcSubscription(mockVscode, ["test", "subscription"], {
          onData,
        }),
      { wrapper: createWrapper() },
    );

    result.current.subscribe({ topic: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
      type: string;
      path: string[];
    };
    expect(messageCall.type).toBe("subscription");
    expect(messageCall.path).toEqual(["test", "subscription"]);

    // Simulate progress update
    simulateSubscriptionUpdate(messageCall.id, "data", { progress: 50 });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onData).toHaveBeenCalledWith({ progress: 50 });
    expect(result.current.progressData).toEqual({ progress: 50 });
    expect(result.current.status).toBe("active");
  });

  it("should handle completion", async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(
      () =>
        useRpcSubscription(mockVscode, ["test", "subscription"], {
          onComplete,
        }),
      { wrapper: createWrapper() },
    );

    result.current.subscribe({ topic: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
    };

    // Simulate completion
    simulateSubscriptionUpdate(messageCall.id, "complete", {
      result: "done",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onComplete).toHaveBeenCalledWith({ result: "done" });
    expect(result.current.data).toEqual({ result: "done" });
    expect(result.current.status).toBe("complete");
  });

  it("should handle errors", async () => {
    const onError = vi.fn();
    const { result } = renderHook(
      () =>
        useRpcSubscription(mockVscode, ["test", "subscription"], {
          onError,
        }),
      { wrapper: createWrapper() },
    );

    result.current.subscribe({ topic: "test" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockVscode.postMessage).toHaveBeenCalled();

    const messageCall = vi.mocked(mockVscode.postMessage).mock.calls[0][0] as {
      id: string;
    };

    // Simulate error
    simulateSubscriptionUpdate(messageCall.id, "error", undefined, {
      message: "Subscription error",
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onError).toHaveBeenCalled();
    expect(result.current.error?.message).toBe("Subscription error");
    expect(result.current.status).toBe("error");
  });
});

describe("initializeRpcMessageHandler", () => {
  it("should route responses correctly", () => {
    const originalHandler = vi.fn();
    const wrappedHandler = initializeRpcMessageHandler(originalHandler);

    // Test RPC response handling
    const rpcResponse = {
      id: "test-1",
      success: true,
      data: { result: "success" },
    };

    wrappedHandler(
      new MessageEvent("message", {
        data: rpcResponse,
      }),
    );

    // RPC responses should not be passed to original handler
    expect(originalHandler).not.toHaveBeenCalled();

    // Test non-RPC message
    const nonRpcMessage = {
      type: "other",
      data: "some data",
    };

    wrappedHandler(
      new MessageEvent("message", {
        data: nonRpcMessage,
      }),
    );

    // Non-RPC messages should be passed to original handler
    expect(originalHandler).toHaveBeenCalled();
  });
});

describe("Message ID generation", () => {
  it("should generate unique IDs", async () => {
    const mockVscode = createMockVscode();
    renderHook(() => useRpcQuery(mockVscode, ["test"]), {
      wrapper: createWrapper(),
    });

    renderHook(() => useRpcQuery(mockVscode, ["test"]), {
      wrapper: createWrapper(),
    });

    // Both should trigger postMessage
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockVscode.postMessage).toHaveBeenCalledTimes(2);

    const calls = vi.mocked(mockVscode.postMessage).mock.calls;
    const id1 = (calls[0][0] as { id: string }).id;
    const id2 = (calls[1][0] as { id: string }).id;

    // IDs should be unique
    expect(id1).not.toBe(id2);
  });
});
