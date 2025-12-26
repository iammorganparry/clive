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

  // Fetch onboarding status only when authenticated and in checkingOnboarding state
  const { data: indexingPreference, isLoading: prefLoading } =
    rpc.config.getIndexingPreference.useQuery({
      enabled: isAuthenticated && state.matches("checkingOnboarding"),
    });

  // Fetch branch changes when checking for conversation
  const { data: branchChanges, isLoading: branchChangesLoading } =
    rpc.status.branchChanges.useQuery({
      enabled: isAuthenticated && state.matches("checkingConversation"),
    });

  // Check for existing branch conversation
  const { data: branchConversation, isLoading: conversationLoading } =
    rpc.conversations.hasBranchConversation.useQuery({
      input: {
        branchName: branchChanges?.branchName || "",
        baseBranch: branchChanges?.baseBranch || "main",
      },
      enabled:
        isAuthenticated &&
        state.matches("checkingConversation") &&
        !!branchChanges &&
        branchChanges.branchName.length > 0,
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

  // Send CONVERSATION_RESULT when conversation check completes
  useEffect(() => {
    if (
      state.matches("checkingConversation") &&
      !branchChangesLoading &&
      branchChanges !== undefined
    ) {
      // If branch changes exist but no branch name, go to dashboard
      if (!branchChanges || branchChanges.branchName.length === 0) {
        send({
          type: "CONVERSATION_RESULT",
          route: Routes.dashboard,
        });
        return;
      }

      // Wait for conversation check to complete if we have branch changes
      if (conversationLoading) {
        return;
      }

      // If we have branch changes with files and a conversation exists, navigate to chat
      if (branchChanges.files.length > 0 && branchConversation?.exists) {
        const filesJson = JSON.stringify(
          branchChanges.files.map((f) => f.path),
        );
        send({
          type: "CONVERSATION_RESULT",
          route: Routes.changesetChat,
          params: {
            files: filesJson,
            branchName: branchChanges.branchName,
          },
        });
      } else {
        // Otherwise, go to dashboard
        send({
          type: "CONVERSATION_RESULT",
          route: Routes.dashboard,
        });
      }
    }
  }, [
    state,
    branchChangesLoading,
    branchChanges,
    conversationLoading,
    branchConversation,
    send,
  ]);

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
