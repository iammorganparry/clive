import type React from "react";
import { createContext, useContext, useCallback, useEffect } from "react";
import { useMachine } from "@xstate/react";
import { Routes, type Route } from "./routes.js";
import { useAuth } from "../contexts/auth-context.js";
import { useRpc } from "../rpc/provider.js";
import { routerMachine, type RouterMachineEvent } from "./router-machine.js";

interface RouterContextValue {
  route: Route;
  isInitializing: boolean;
  navigate: (route: Route) => void;
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

  // Fetch onboarding status only when authenticated and in checkingOnboarding state
  const { data: indexingPreference, isLoading: prefLoading } =
    rpc.config.getIndexingPreference.useQuery({
      enabled: isAuthenticated && state.matches("checkingOnboarding"),
    });

  // Send AUTH_RESULT when auth loading completes
  useEffect(() => {
    if (!authLoading && state.matches("initializing")) {
      send({ type: "AUTH_RESULT", isAuthenticated, token: token ?? null });
    }
  }, [authLoading, isAuthenticated, token, state, send]);

  // Send ONBOARDING_RESULT when preference loading completes
  useEffect(() => {
    if (
      !prefLoading &&
      indexingPreference !== undefined &&
      state.matches("checkingOnboarding")
    ) {
      send({
        type: "ONBOARDING_RESULT",
        onboardingComplete: indexingPreference?.onboardingComplete ?? false,
      });
    }
  }, [prefLoading, indexingPreference, state, send]);

  // Derive initialization state from machine state
  const isInitializing =
    state.matches("initializing") || state.matches("checkingOnboarding");

  // Get current route from machine context
  const route = state.context.route;

  const navigate = useCallback(
    (newRoute: Route) => {
      send({ type: "NAVIGATE", route: newRoute });
    },
    [send],
  );

  const goBack = useCallback(() => {
    // For simplicity, navigate to dashboard when going back
    // Could be enhanced with history tracking in machine context if needed
    send({ type: "NAVIGATE", route: Routes.dashboard });
  }, [send]);

  return (
    <RouterContext.Provider
      value={{ route, isInitializing, navigate, goBack, send }}
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
