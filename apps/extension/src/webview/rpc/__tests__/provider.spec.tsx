import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RpcProvider, useRpc } from "../provider.js";
import type { VSCodeAPI } from "../../services/vscode.js";

// Mock VSCodeAPI
const createMockVscode = (): VSCodeAPI => {
  return {
    postMessage: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
  };
};

// Wrapper for React Query
const createQueryWrapper = () => {
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

describe("RpcProvider", () => {
  let mockVscode: VSCodeAPI;

  beforeEach(() => {
    mockVscode = createMockVscode();
    vi.clearAllMocks();
  });

  it("should create client with correct structure", () => {
    const QueryWrapper = createQueryWrapper();

    const { result } = renderHook(() => useRpc(), {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <RpcProvider vscode={mockVscode}>{children}</RpcProvider>
        </QueryWrapper>
      ),
    });

    const client = result.current;

    // Client should have the router structure
    expect(client).toBeDefined();
    expect(client.status).toBeDefined();
    expect(client.agents).toBeDefined();

    // Procedures should have hook methods
    expect(client.status.cypress).toBeDefined();
    expect(client.status.cypress.useQuery).toBeDefined();
    expect(typeof client.status.cypress.useQuery).toBe("function");

    expect(client.agents.planTests).toBeDefined();
    expect(client.agents.planTests.useSubscription).toBeDefined();
    expect(typeof client.agents.planTests.useSubscription).toBe("function");
  });

  it("should provide client through context", () => {
    const QueryWrapper = createQueryWrapper();

    const TestComponent = () => {
      const rpc = useRpc();
      expect(rpc).toBeDefined();
      expect(rpc.status).toBeDefined();
      return null;
    };

    render(
      <QueryWrapper>
        <RpcProvider vscode={mockVscode}>
          <TestComponent />
        </RpcProvider>
      </QueryWrapper>,
    );
  });
});

describe("useRpc", () => {
  let mockVscode: VSCodeAPI;

  beforeEach(() => {
    mockVscode = createMockVscode();
    vi.clearAllMocks();
  });

  it("should return typed client", () => {
    const QueryWrapper = createQueryWrapper();

    const { result } = renderHook(() => useRpc(), {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <RpcProvider vscode={mockVscode}>{children}</RpcProvider>
        </QueryWrapper>
      ),
    });

    const client = result.current;

    // Verify client structure matches AppRouter
    expect(client.status).toBeDefined();
    expect(client.status.cypress).toBeDefined();
    expect(client.status.branchChanges).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.agents.planTests).toBeDefined();
  });

  it("should throw outside provider", () => {
    const QueryWrapper = createQueryWrapper();

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useRpc(), {
        wrapper: QueryWrapper,
      });
    }).toThrow("useRpc must be used within an RpcProvider");

    consoleSpy.mockRestore();
  });
});

describe("Client proxy", () => {
  let mockVscode: VSCodeAPI;

  beforeEach(() => {
    mockVscode = createMockVscode();
    vi.clearAllMocks();
  });

  it("should navigate to nested procedures", () => {
    const QueryWrapper = createQueryWrapper();

    const { result } = renderHook(() => useRpc(), {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <RpcProvider vscode={mockVscode}>{children}</RpcProvider>
        </QueryWrapper>
      ),
    });

    const client = result.current;

    // Test nested navigation
    expect(client.status.cypress).toBeDefined();
    expect(client.status.branchChanges).toBeDefined();
    expect(client.agents.planTests).toBeDefined();
  });

  it("should return hook factories for procedures", () => {
    const QueryWrapper = createQueryWrapper();

    // Test calling hooks inside a proper component
    const TestComponent = () => {
      const client = useRpc();
      
      // Query procedure should have useQuery
      const queryHook = client.status.cypress.useQuery();
      expect(queryHook).toBeDefined();
      expect(queryHook).toHaveProperty('data'); // Hook returns object with data property
      
      // Subscription procedure should have useSubscription
      const planTestsHook = client.agents.planTests.useSubscription();
      expect(planTestsHook).toBeDefined();
      expect(typeof planTestsHook.subscribe).toBe("function");
      
      return null;
    };

    render(
      <QueryWrapper>
        <RpcProvider vscode={mockVscode}>
          <TestComponent />
        </RpcProvider>
      </QueryWrapper>,
    );
  });

  it("should handle deeply nested routers", () => {
    const QueryWrapper = createQueryWrapper();

    const { result } = renderHook(() => useRpc(), {
      wrapper: ({ children }) => (
        <QueryWrapper>
          <RpcProvider vscode={mockVscode}>{children}</RpcProvider>
        </QueryWrapper>
      ),
    });

    const client = result.current;

    // Verify we can access nested procedures
    expect(client.status).toBeDefined();
    expect(client.status.cypress).toBeDefined();
    expect(client.agents).toBeDefined();
    expect(client.agents.planTests).toBeDefined();
  });
});
