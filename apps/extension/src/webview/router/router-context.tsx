import type React from "react";
import { createContext, useContext, useCallback, useEffect } from "react";
import { useMachine } from "@xstate/react";
import { Routes, type Route } from "./routes.js";
import { useAuth } from "../contexts/auth-context.js";
import { useRpc } from "../rpc/provider.js";
import { routerMachine, type RouterMachineEvent } from "./router-machine.js";

interface RouterContextValue {
  route: Route;
  routeParams: Record<string, string>;
  isInitializing: boolean;
  navigate: (route: Route, params?: Record<string, string>) => void;
  goBack: () => void;
  send: (event: RouterMachineEvent) => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

interface RouterProviderProps {
  children: React.ReactNode;
}

export const RouterProvider: React.FC<RouterProviderProps> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading, token } = useAuth();
  const rpc = useRpc();

  const [state, send] = useMachine(routerMachine);

  // Fetch branch changes when checking for conversation
  const { data: branchChanges, isLoading: branchChangesLoading } =
    rpc.status.branchChanges.useQuery({
      enabled: isAuthenticated && state.matches("checkingConversation"),
    });

  // Send AUTH_RESULT when auth loading completes
  useEffect(() => {
    if (!authLoading && state.matches("initializing")) {
      send({ type: "AUTH_RESULT", isAuthenticated, token: token ?? null });
    }
  }, [authLoading, isAuthenticated, token, state, send]);

  // Skip onboarding check - send ONBOARDING_RESULT immediately after auth
  useEffect(() => {
    if (isAuthenticated && state.matches("checkingOnboarding")) {
      send({
        type: "ONBOARDING_RESULT",
        onboardingComplete: true,
      });
    }
  }, [isAuthenticated, state, send]);

  // Send CONVERSATION_RESULT when conversation check completes
  useEffect(() => {
    if (
      state.matches("checkingConversation") &&
      !branchChangesLoading &&
      branchChanges !== undefined
    ) {
      // Always go to dashboard - user decides when to navigate to chat
      send({
        type: "CONVERSATION_RESULT",
        route: Routes.dashboard,
      });
    }
  }, [
    state,
    branchChangesLoading,
    branchChanges,
    send,
  ]);

  // React to auth state changes - send LOGOUT when isAuthenticated becomes false
  // This handles the logout flow reactively, avoiding race conditions
  useEffect(() => {
    const isInAuthenticatedState =
      state.matches("ready") ||
      state.matches("checkingOnboarding") ||
      state.matches("checkingConversation") ||
      state.matches("needsOnboarding");

    if (!isAuthenticated && !authLoading && isInAuthenticatedState) {
      send({ type: "LOGOUT" });
    }
  }, [isAuthenticated, authLoading, state, send]);

  // Derive initialization state from machine state
  const isInitializing =
    state.matches("initializing") ||
    state.matches("checkingOnboarding") ||
    state.matches("checkingConversation");

  // Get current route and params from machine context
  const route = state.context.route;
  const routeParams = state.context.routeParams;

  const navigate = useCallback(
    (newRoute: Route, params?: Record<string, string>) => {
      send({ type: "NAVIGATE", route: newRoute, params });
    },
    [send],
  );

  const goBack = useCallback(() => {
    // For simplicity, navigate to dashboard when going back
    // Could be enhanced with history tracking in machine context if needed
    send({ type: "NAVIGATE", route: Routes.dashboard, params: {} });
  }, [send]);

  return (
    <RouterContext.Provider
      value={{ route, routeParams, isInitializing, navigate, goBack, send }}
    >
      {children}
    </RouterContext.Provider>
  );
};

export const useRouter = (): RouterContextValue => {
  const context = useContext(RouterContext);
  if (context === undefined) {
    throw new Error("useRouter must be used within a RouterProvider");
  }
  return context;
};
