import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useMemo } from "react";
import { useRpc } from "../rpc/provider.js";

/**
 * Better Auth JWT payload structure
 * Based on the JWT plugin output from better-auth
 */
interface BetterAuthJwtPayload {
  sub: string; // userId
  email?: string;
  name?: string;
  image?: string;
  activeOrganizationId?: string;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface UserData {
  userId: string;
  email?: string;
  name?: string;
  imageUrl?: string;
  organizationId?: string;
}

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

/**
 * Decodes a JWT token and extracts user data from the payload
 */
function decodeJWT(token: string): UserData | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split(".");
    if (parts.length !== 3) {
      console.error("Invalid JWT format");
      return null;
    }

    // Decode the payload (second part)
    const payload = parts[1];
    // Replace base64url characters
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);

    // Decode base64
    const decoded = atob(padded);
    const parsed = JSON.parse(decoded) as BetterAuthJwtPayload;

    // Better Auth JWT uses 'sub' for userId
    if (!parsed.sub) {
      console.error("Invalid JWT: missing sub claim");
      return null;
    }

    return {
      userId: parsed.sub,
      email: parsed.email,
      name: parsed.name,
      imageUrl: parsed.image,
      organizationId: parsed.activeOrganizationId,
    };
  } catch (error) {
    console.error("Failed to decode JWT token:", error);
    return null;
  }
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

  // Decode user data from token
  const user = useMemo(() => {
    if (!token) return null;
    return decodeJWT(token);
  }, [token]);

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
