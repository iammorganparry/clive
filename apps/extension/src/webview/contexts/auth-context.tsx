import { createContext, useContext, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WebviewMessages } from "../../constants.js";
import type { VSCodeAPI } from "../services/vscode.js";
import { useMessageHandler } from "../hooks/use-message-handler.js";

export interface UserData {
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  imageUrl?: string;
  [key: string]: unknown;
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
  vscode: VSCodeAPI;
}

const TOKEN_STORAGE_KEY = "auth_token";
const AUTH_TOKEN_QUERY_KEY = ["auth-token"];

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
    const parsed = JSON.parse(decoded) as Record<string, unknown>;

    // Extract user data from Better Auth JWT payload
    // Better Auth uses 'id' for userId, 'email', 'name', 'image', etc.
    return {
      userId:
        (parsed.id as string) ||
        (parsed.sub as string) ||
        (parsed.user_id as string) ||
        "",
      email: parsed.email as string | undefined,
      firstName:
        (parsed.first_name as string) ||
        (parsed.firstName as string) ||
        undefined,
      lastName:
        (parsed.last_name as string) ||
        (parsed.lastName as string) ||
        undefined,
      username:
        (parsed.username as string) ||
        (parsed.name as string) ||
        undefined,
      imageUrl:
        (parsed.image as string) || // Better Auth uses 'image' field
        (parsed.image_url as string) ||
        (parsed.imageUrl as string) ||
        undefined,
      ...parsed,
    };
  } catch (error) {
    console.error("Failed to decode JWT token:", error);
    return null;
  }
}

export const AuthProvider = ({ children, vscode }: AuthProviderProps) => {
  const queryClient = useQueryClient();

  // Load token from VS Code state using React Query
  const { data: token, isLoading } = useQuery<string | null>({
    queryKey: AUTH_TOKEN_QUERY_KEY,
    queryFn: () => {
      try {
        const state = vscode.getState() as
          | { [TOKEN_STORAGE_KEY]?: string }
          | undefined;
        const storedToken = state?.[TOKEN_STORAGE_KEY];
        return storedToken || null;
      } catch (error) {
        console.error("Failed to load token from VS Code state:", error);
        return null;
      }
    },
    staleTime: Infinity, // Token doesn't change unless explicitly updated
    gcTime: Infinity, // Keep in cache indefinitely
  });

  // Decode user data from token
  const user = useMemo(() => {
    if (!token) return null;
    return decodeJWT(token);
  }, [token]);

  // Save token to VS Code state and update React Query cache
  const saveToken = useCallback(
    (newToken: string | null) => {
      try {
        const currentState =
          (vscode.getState() as Record<string, unknown>) || {};
        const newState = {
          ...currentState,
          [TOKEN_STORAGE_KEY]: newToken,
        };
        vscode.setState(newState);
        // Update React Query cache
        queryClient.setQueryData(AUTH_TOKEN_QUERY_KEY, newToken);
        // Persist token to secret storage via extension
        if (newToken) {
          vscode.postMessage({
            command: WebviewMessages.storeAuthToken,
            token: newToken,
          });
        }
      } catch (error) {
        console.error("Failed to save token to VS Code state:", error);
      }
    },
    [vscode, queryClient],
  );

  // Listen for auth token messages from extension
  useMessageHandler(
    useCallback(
      (event: MessageEvent) => {
        const message = event.data;
        if (message.command === WebviewMessages.authToken) {
          const tokenValue = (message as { token?: string }).token;
          if (tokenValue) {
            saveToken(tokenValue);
            // Notify extension that token was received
            vscode.postMessage({
              command: WebviewMessages.authTokenReceived,
            });
          }
        }
      },
      [vscode, saveToken],
    ),
  );

  const login = useCallback(async () => {
    // Open login page in browser via extension
    vscode.postMessage({
      command: WebviewMessages.openLoginPage,
    });
  }, [vscode]);

  const logout = useCallback(() => {
    saveToken(null);
  }, [saveToken]);

  const checkSession = useCallback(() => {
    // Request session check from extension
    vscode.postMessage({
      command: WebviewMessages.checkSession,
    });
  }, [vscode]);

  const setToken = useCallback(
    (newToken: string) => {
      saveToken(newToken);
    },
    [saveToken],
  );

  const value: AuthContextType = {
    token: token ?? null,
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
