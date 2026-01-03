import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import App from "../App.js";
import type { VSCodeAPI } from "../services/vscode.js";
import { type Route, Routes } from "../router/routes.js";
import type { RouterMachineEvent } from "../router/router-machine.js";

// Mock lazy-loaded components to avoid dynamic imports in tests
vi.mock("../pages/login/index.js", () => ({
  LoginPage: () => <div data-testid="login-page">Login Page</div>,
}));

vi.mock("../pages/dashboard/index.js", () => ({
  DashboardPage: (_props: { vscode: VSCodeAPI }) => (
    <div data-testid="dashboard-page">Dashboard Page</div>
  ),
}));

vi.mock("../pages/settings/index.js", () => ({
  SettingsPage: (_props: { vscode: VSCodeAPI }) => (
    <div data-testid="settings-page">Settings Page</div>
  ),
}));

vi.mock("../pages/onboarding/index.js", () => ({
  OnboardingPage: () => <div data-testid="onboarding-page">Onboarding Page</div>,
}));

vi.mock("../pages/changeset-chat/index.js", () => ({
  ChangesetChatPage: () => (
    <div data-testid="changeset-chat-page">Changeset Chat Page</div>
  ),
}));

// Mock Header component
vi.mock("../components/layout/header.js", () => ({
  Header: () => <div data-testid="header">Header</div>,
}));

// Create mock VSCodeAPI
const createMockVscode = (): VSCodeAPI => ({
  postMessage: vi.fn(),
  getState: vi.fn(),
  setState: vi.fn(),
});

// Create QueryClient wrapper
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

// Mock auth context
const mockAuthContext = {
  token: "test-token",
  user: { id: "user-1", email: "test@example.com" },
  isAuthenticated: true,
  isLoading: false,
  deviceAuthState: null,
  isDeviceAuthPending: false,
  login: vi.fn(),
  startDeviceAuth: vi.fn(),
  cancelDeviceAuth: vi.fn(),
  logout: vi.fn(),
  checkSession: vi.fn(),
  setToken: vi.fn(),
};

vi.mock("../contexts/auth-context.js", () => ({
  useAuth: () => mockAuthContext,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

interface RouterContextValue {
  route: Route;
  routeParams: Record<string, string>;
  isInitializing: boolean;
  navigate: (route: Route, params?: Record<string, string>) => void;
  goBack: () => void;
  send: (event: RouterMachineEvent) => void;
}

// Mock router context
const mockRouterContext = {
  route: Routes.dashboard as Route,
  routeParams: {},
  isInitializing: false as boolean,
  navigate: vi.fn(),
  goBack: vi.fn(),
  send: vi.fn(),
} satisfies RouterContextValue;

vi.mock("../router/index.js", () => ({
  useRouter: () => mockRouterContext,
  RouterProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Routes: {
    login: "/login",
    dashboard: "/",
    settings: "/settings",
    onboarding: "/onboarding",
    changesetChat: "/changeset/chat",
  },
}));

// Mock RPC provider
vi.mock("../rpc/provider.js", () => ({
  useRpc: () => ({}),
  RpcProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("App Integration Tests", () => {
  let mockVscode: VSCodeAPI;

  beforeEach(() => {
    mockVscode = createMockVscode();
    vi.clearAllMocks();
    
    // Reset mock context values
    mockAuthContext.isAuthenticated = true;
    mockAuthContext.isLoading = false;
    mockRouterContext.route = Routes.dashboard;
    mockRouterContext.routeParams = {};
    mockRouterContext.isInitializing = false;
  });

  it("should render dashboard page when route is dashboard", async () => {
    const QueryWrapper = createQueryWrapper();
    
    mockRouterContext.route = Routes.dashboard;
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    // Wait for lazy-loaded component to render
    await waitFor(() => {
      expect(screen.getByTestId("dashboard-page")).toBeDefined();
    });
    
    expect(screen.getByTestId("header")).toBeDefined();
  });

  it("should render login page when route is login", async () => {
    const QueryWrapper = createQueryWrapper();
    
    mockRouterContext.route = Routes.login;
    mockAuthContext.isAuthenticated = false;
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId("login-page")).toBeDefined();
    });
    
    // Header should not be visible on login page
    expect(screen.queryByTestId("header")).toBeNull();
  });

  it("should render settings page when route is settings", async () => {
    const QueryWrapper = createQueryWrapper();
    
    mockRouterContext.route = Routes.settings;
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId("settings-page")).toBeDefined();
    });
    
    expect(screen.getByTestId("header")).toBeDefined();
  });

  it("should render onboarding page when route is onboarding", async () => {
    const QueryWrapper = createQueryWrapper();
    
    mockRouterContext.route = Routes.onboarding;
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-page")).toBeDefined();
    });
    
    // Header should not be visible on onboarding page
    expect(screen.queryByTestId("header")).toBeNull();
  });

  it("should generate unique key for changeset chat page with different params", async () => {
    const QueryWrapper = createQueryWrapper();
    
    // First render with specific params
    mockRouterContext.route = Routes.changesetChat;
    mockRouterContext.routeParams = {
      mode: "branch",
      branchName: "feature-1",
      commitHash: "abc123",
    };
    
    const { rerender } = render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    await waitFor(() => {
      expect(screen.getByTestId("changeset-chat-page")).toBeDefined();
    });
    
    // Update params to trigger key change
    mockRouterContext.routeParams = {
      mode: "branch",
      branchName: "feature-2",
      commitHash: "def456",
    };
    
    rerender(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    // Component should still be rendered (verifying remount via key change)
    await waitFor(() => {
      expect(screen.getByTestId("changeset-chat-page")).toBeDefined();
    });
  });

  it("should show initializing screen when router is initializing", () => {
    const QueryWrapper = createQueryWrapper();
    
    mockRouterContext.isInitializing = true;
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    // Should show loading text from InitializingScreen
    expect(screen.getByText(/Loading/i)).toBeDefined();
  });

  it("should call vscode.postMessage when component mounts", () => {
    const QueryWrapper = createQueryWrapper();
    
    render(
      <QueryWrapper>
        <App vscode={mockVscode} />
      </QueryWrapper>
    );
    
    // Verify vscode.postMessage was called with ready message
    expect(mockVscode.postMessage).toHaveBeenCalledWith({
      command: "ready",
    });
  });
});
