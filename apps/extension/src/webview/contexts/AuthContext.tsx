import { createContext, useContext, useCallback } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WebviewMessages } from "../../constants.js";
import type { VSCodeAPI } from "../services/vscode.js";
import { useMessageHandler } from "../hooks/useMessageHandler.js";

interface AuthContextType {
	token: string | null;
	isAuthenticated: boolean;
	isLoading: boolean;
	login: () => Promise<void>;
	logout: () => void;
	checkSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
	children: ReactNode;
	vscode: VSCodeAPI;
}

const TOKEN_STORAGE_KEY = "auth_token";
const AUTH_TOKEN_QUERY_KEY = ["auth-token"];

export const AuthProvider = ({ children, vscode }: AuthProviderProps) => {
	const queryClient = useQueryClient();

	// Load token from VS Code state using React Query
	const {
		data: token,
		isLoading,
	} = useQuery<string | null>({
		queryKey: AUTH_TOKEN_QUERY_KEY,
		queryFn: () => {
			try {
				const state = vscode.getState() as { [TOKEN_STORAGE_KEY]?: string } | undefined;
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

	// Save token to VS Code state and update React Query cache
	const saveToken = useCallback(
		(newToken: string | null) => {
			try {
				const currentState = (vscode.getState() as Record<string, unknown>) || {};
				const newState = {
					...currentState,
					[TOKEN_STORAGE_KEY]: newToken,
				};
				vscode.setState(newState);
				// Update React Query cache
				queryClient.setQueryData(AUTH_TOKEN_QUERY_KEY, newToken);
			} catch (error) {
				console.error("Failed to save token to VS Code state:", error);
			}
		},
		[vscode, queryClient]
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
			[vscode, saveToken]
		)
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

	const value: AuthContextType = {
		token: token ?? null,
		isAuthenticated: !!token,
		isLoading,
		login,
		logout,
		checkSession,
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

