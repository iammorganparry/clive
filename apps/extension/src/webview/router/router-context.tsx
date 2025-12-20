import type React from "react";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { Routes, type Route } from "./routes.js";
import { useAuth } from "../contexts/auth-context.js";

interface RouterContextValue {
  route: Route;
  navigate: (route: Route) => void;
  goBack: () => void;
}

const RouterContext = createContext<RouterContextValue | undefined>(undefined);

interface RouterProviderProps {
  children: React.ReactNode;
}

export const RouterProvider: React.FC<RouterProviderProps> = ({ children }) => {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [route, setRoute] = useState<Route>(Routes.login);
  const [_history, setHistory] = useState<Route[]>([Routes.login]);

  // Auth-aware navigation: redirect unauthenticated users to login
  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated && route !== Routes.login) {
        setRoute(Routes.login);
        setHistory([Routes.login]);
      } else if (isAuthenticated && route === Routes.login) {
        setRoute(Routes.dashboard);
        setHistory([Routes.dashboard]);
      }
    }
  }, [isAuthenticated, authLoading, route]);

  const navigate = useCallback((newRoute: Route) => {
    setRoute(newRoute);
    setHistory((prev) => [...prev, newRoute]);
  }, []);

  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length > 1) {
        const newHistory = prev.slice(0, -1);
        const previousRoute = newHistory[newHistory.length - 1];
        setRoute(previousRoute);
        return newHistory;
      }
      return prev;
    });
  }, []);

  return (
    <RouterContext.Provider value={{ route, navigate, goBack }}>
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
