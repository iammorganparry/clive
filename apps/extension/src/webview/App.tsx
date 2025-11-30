import React, { useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Welcome from "./components/Welcome.js";
import CypressStatus from "./components/CypressStatus.js";
import { Login } from "./components/Login.js";
import { WebviewMessages } from "../constants.js";
import { logger } from "./services/logger.js";
import type { VSCodeAPI } from "./services/vscode.js";
import { useAuth } from "./contexts/AuthContext.js";

interface AppProps {
	vscode: VSCodeAPI;
}

interface CypressStatusData {
	overallStatus: "installed" | "not_installed" | "partial";
	packages: Array<{
		name: string;
		path: string;
		relativePath: string;
		hasCypressPackage: boolean;
		hasCypressConfig: boolean;
		isConfigured: boolean;
	}>;
	workspaceRoot: string;
}

interface MessageData {
	command: string;
	status?: CypressStatusData;
	error?: string;
	targetDirectory?: string;
}

// Store pending promises for message responses
const pendingPromises = new Map<
	string,
	{ resolve: (value: MessageData) => void; reject: (error: Error) => void }
>();

// Create a Promise-based message system
const createMessagePromise = (
	vscode: VSCodeAPI,
	command: string,
	expectedResponseCommand: string
): Promise<MessageData> => {
	return new Promise<MessageData>((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingPromises.delete(expectedResponseCommand);
			reject(new Error("Request timeout"));
		}, 10000);

		pendingPromises.set(expectedResponseCommand, {
			resolve: (value) => {
				clearTimeout(timeout);
				pendingPromises.delete(expectedResponseCommand);
				resolve(value);
			},
			reject: (error) => {
				clearTimeout(timeout);
				pendingPromises.delete(expectedResponseCommand);
				reject(error);
			},
		});

		logger.message.send(command);
		vscode.postMessage({ command });
	});
};

const App: React.FC<AppProps> = ({ vscode }) => {
	logger.component.render("App", { vscodeAvailable: !!vscode });
	const queryClient = useQueryClient();

	// Use AuthContext for authentication
	const { isAuthenticated, isLoading: authLoading, token } = useAuth();

	// Handle incoming messages from extension
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data as MessageData;
			logger.message.receive(message.command, message);

			// Check if there's a pending promise for this command (for Cypress status)
			const pending = pendingPromises.get(message.command);
			if (pending) {
				if (message.error) {
					pending.reject(new Error(message.error));
				} else {
					pending.resolve(message);
				}
			}

			// Update the query cache with the new status
			if (message.command === WebviewMessages.cypressStatus && message.status) {
				queryClient.setQueryData<CypressStatusData>(
					["cypress-status"],
					message.status
				);
			}
		},
		[queryClient]
	);

	console.log("[Clive] App render state", {
		isAuthenticated,
		authLoading,
		hasToken: !!token,
	});

	// Set up message listener to update query cache and resolve promises
	React.useEffect(() => {
		window.addEventListener("message", handleMessage);

		// Notify extension that webview is ready
		logger.info("Webview ready, notifying extension");
		logger.message.send(WebviewMessages.ready);
		vscode.postMessage({
			command: WebviewMessages.ready,
		});

		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [vscode, handleMessage]);

	// Clerk handles session management, so we use isSignedIn and user from useUser hook

	// Query for Cypress status (only when authenticated)
	const {
		data: cypressStatus,
		isLoading,
		error: queryError,
	} = useQuery<CypressStatusData, Error>({
		queryKey: ["cypress-status"],
		queryFn: async () => {
			logger.query.start("cypress-status");
			try {
				const message = await createMessagePromise(
					vscode,
					WebviewMessages.refreshStatus,
					WebviewMessages.cypressStatus
				);

				if (!message.status) {
					throw new Error("No status received");
				}

				logger.query.success("cypress-status", message.status);
				return message.status;
			} catch (error) {
				logger.query.error("cypress-status", error);
				throw error;
			}
		},
		refetchInterval: false,
		enabled: isAuthenticated && !authLoading, // Only fetch when authenticated
	});

	// Handle successful setup - refetch status
	const handleSetupSuccess = useCallback(() => {
		// Refetch status after successful setup
		// The file watcher should trigger an update, but we'll also manually refetch
		setTimeout(() => {
			queryClient.invalidateQueries({ queryKey: ["cypress-status"] });
		}, 3000);
	}, [queryClient]);

	// Mutation for setting up Cypress
	const setupMutation = useMutation({
		mutationFn: async (targetDirectory?: string): Promise<void> => {
			vscode.postMessage({
				command: WebviewMessages.setupCypress,
				targetDirectory,
			});

			return new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					window.removeEventListener("message", handler);
					reject(new Error("Setup timeout"));
				}, 60000); // 60 seconds for setup

				const handler = (event: MessageEvent) => {
					const message = event.data as MessageData;
					if (message.command === WebviewMessages.setupError) {
						clearTimeout(timeout);
						window.removeEventListener("message", handler);
						reject(new Error(message.error || "Setup failed"));
					} else if (message.command === WebviewMessages.setupStart) {
						// Setup started successfully
						// The status will be refreshed automatically via file watcher
						// Wait a bit then resolve - status update will come via query cache
						setTimeout(() => {
							clearTimeout(timeout);
							window.removeEventListener("message", handler);
							resolve();
						}, 1000);
					}
				};

				window.addEventListener("message", handler);
			});
		},
		onSuccess: handleSetupSuccess,
	});

	const handleSetup = (targetDirectory?: string) => {
		setupMutation.mutate(targetDirectory);
	};

	const handleLoginSuccess = useCallback(() => {
		// AuthContext handles login state automatically
		// Token is already set, so we can proceed
	}, []);

	const error = queryError?.message || setupMutation.error?.message;

	return (
		<div className="w-full h-full overflow-auto bg-background text-foreground">
			{isLoading && !cypressStatus ? (
				<>
					{isAuthenticated ? (
						<Welcome />
					) : (
						<Login onLoginSuccess={handleLoginSuccess} />
					)}
				</>
			) : cypressStatus ? (
				<CypressStatus
					status={cypressStatus}
					onSetup={handleSetup}
					setupInProgress={
						setupMutation.isPending
							? setupMutation.variables || undefined
							: undefined
					}
					error={error}
				/>
			) : (
				<Welcome />
			)}
		</div>
	);
};

export default App;
