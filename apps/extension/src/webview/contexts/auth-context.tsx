import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRpc } from "../rpc/provider.js";
import type { UserInfo } from "../../services/config-service.js";

export type UserData = UserInfo;

export interface DeviceAuthState {
  sessionId: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
}

interface AuthContextType {
  token: string | null;
  user: UserData | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  deviceAuthState: DeviceAuthState | null;
  isDeviceAuthPending: boolean;
  login: () => Promise<void>;
  startDeviceAuth: () => Promise<DeviceAuthState | null>;
  cancelDeviceAuth: () => void;
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
  const [deviceAuthState, setDeviceAuthState] =
    useState<DeviceAuthState | null>(null);

  // Check session using RPC - reads from secret storage (single source of truth)
  // Poll every 2 seconds when device auth is pending, otherwise disable polling
  const {
    data: sessionData,
    isLoading: isCheckingSession,
    refetch: refetchSession,
  } = rpc.auth.checkSession.useQuery({
    refetchInterval: deviceAuthState ? 2000 : false,
  });

  // Token comes exclusively from secret storage via RPC
  const token = sessionData?.token ?? null;
  const isLoading = isCheckingSession;

  const user = useMemo(() => {
    const userInfo = sessionData?.userInfo;
    if (!userInfo?.userId) return null;
    return userInfo;
  }, [sessionData?.userInfo]);

  // Clear device auth state when authenticated
  useEffect(() => {
    if (token && deviceAuthState) {
      setDeviceAuthState(null);
    }
  }, [token, deviceAuthState]);

  // Store token mutation - persists to secret storage
  const storeTokenMutation = rpc.auth.storeToken.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["rpc", "auth", "checkSession"],
      });
    },
  });

  const deviceAuthMutation = rpc.auth.startDeviceAuth.useMutation();
  const cancelDeviceAuthMutation = rpc.auth.cancelDeviceAuth.useMutation();
  const logoutMutation = rpc.auth.logout.useMutation({
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["rpc", "auth", "checkSession"],
      });
    },
  });

  const startDeviceAuth = useCallback(async () => {
    try {
      const result = await deviceAuthMutation.mutateAsync();
      if (result) {
        const state: DeviceAuthState = {
          sessionId: result.sessionId,
          userCode: result.userCode,
          verificationUri: result.verificationUri,
          verificationUriComplete: result.verificationUriComplete,
        };
        setDeviceAuthState(state);
        return state;
      }
      return null;
    } catch {
      return null;
    }
  }, [deviceAuthMutation]);

  const cancelDeviceAuth = useCallback(() => {
    if (deviceAuthState) {
      cancelDeviceAuthMutation.mutate({ sessionId: deviceAuthState.sessionId });
      setDeviceAuthState(null);
    }
  }, [deviceAuthState, cancelDeviceAuthMutation]);

  const login = useCallback(async () => {
    // Use device auth flow
    await startDeviceAuth();
  }, [startDeviceAuth]);

  const logout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const checkSession = useCallback(() => {
    refetchSession();
  }, [refetchSession]);

  const setToken = useCallback(
    (newToken: string) => {
      storeTokenMutation.mutate({ token: newToken });
    },
    [storeTokenMutation],
  );

  const value: AuthContextType = {
    token,
    user,
    isAuthenticated: !!token,
    isLoading,
    deviceAuthState,
    isDeviceAuthPending: !!deviceAuthState,
    login,
    startDeviceAuth,
    cancelDeviceAuth,
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
