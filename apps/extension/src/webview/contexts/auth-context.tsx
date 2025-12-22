import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { useRpc } from "../rpc/provider.js";
import type { UserInfo } from "../../services/config-service.js";

export type UserData = UserInfo;

interface AuthContextType {
  token: string | null;
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: () => Promise<void>;
  logout: () => void;
  checkSession: () => void;
  setToken: (token: string) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const queryClient = useQueryClient();
  const rpc = useRpc();

  // Check session using RPC - reads from secret storage (single source of truth)
  const {
    data: sessionData,
    isLoading: isCheckingSession,
    refetch: refetchSession,
  } = rpc.auth.checkSession.useQuery();

  // Token comes exclusively from secret storage via RPC
  const token = sessionData?.token ?? null;
  const isLoading = isCheckingSession;

  const user = useMemo(() => {
    const userInfo = sessionData?.userInfo;
    if (!userInfo?.userId) return null;
    return userInfo;
  }, [sessionData?.userInfo]);

  // Store token mutation - persists to secret storage
  const storeTokenMutation = rpc.auth.storeToken.useMutation({
    onSuccess: () => {
      // Invalidate session query to refetch the new token
      queryClient.invalidateQueries({
        queryKey: ["rpc", "auth", "checkSession"],
      });
    },
  });

  const loginMutation = rpc.auth.openLogin.useMutation();
  const logoutMutation = rpc.auth.logout.useMutation({
    onSuccess: () => {
      // Invalidate session query to clear the token
      queryClient.invalidateQueries({
        queryKey: ["rpc", "auth", "checkSession"],
      });
    },
  });

  const login = useCallback(async () => {
    // Open login page in browser via RPC
    loginMutation.mutate({ url: undefined });
  }, [loginMutation]);

  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const checkSession = useCallback(() => {
    // Request session check from extension via RPC
    refetchSession();
  }, [refetchSession]);

  const setToken = useCallback(
    (newToken: string) => {
      // Store token in secret storage via RPC
      storeTokenMutation.mutate({ token: newToken });
    },
    [storeTokenMutation],
  );

  const value: AuthContextType = {
    token,
    user,
    isAuthenticated: !!token,
    isLoading,
    login,
    logout,
    checkSession,
    setToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
