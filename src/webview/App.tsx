import React, { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Welcome from './components/Welcome';
import PlaywrightStatus from './components/PlaywrightStatus';
import { WebviewMessages } from '../constants';

interface VSCodeAPI {
	postMessage: (message: unknown) => void;
	getState: () => unknown;
	setState: (state: unknown) => void;
}

interface AppProps {
	vscode: VSCodeAPI;
}

interface PlaywrightStatusData {
	overallStatus: 'installed' | 'not_installed' | 'partial';
	packages: Array<{
		name: string;
		path: string;
		relativePath: string;
		hasPlaywrightPackage: boolean;
		hasPlaywrightConfig: boolean;
		isConfigured: boolean;
	}>;
	workspaceRoot: string;
}

interface MessageData {
	command: string;
	status?: PlaywrightStatusData;
	error?: string;
	targetDirectory?: string;
}

// Store pending promises for message responses
const pendingPromises = new Map<
	string,
	{ resolve: (value: MessageData) => void; reject: (error: Error) => void }
>();

// Create a promise-based message system for React Query
const createMessagePromise = (
	vscode: VSCodeAPI,
	command: string,
	expectedResponseCommand: string
): Promise<MessageData> => {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pendingPromises.delete(expectedResponseCommand);
			reject(new Error('Request timeout'));
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

		vscode.postMessage({ command });
	});
};

const App: React.FC<AppProps> = ({ vscode }) => {
	const queryClient = useQueryClient();

	// Handle incoming messages from extension
	const handleMessage = useCallback(
		(event: MessageEvent) => {
			const message = event.data as MessageData;

			// Check if there's a pending promise for this command
			const pending = pendingPromises.get(message.command);
			if (pending) {
				if (message.error) {
					pending.reject(new Error(message.error));
				} else {
					pending.resolve(message);
				}
			}

			// Update the query cache with the new status
			if (message.command === WebviewMessages.playwrightStatus && message.status) {
				queryClient.setQueryData<PlaywrightStatusData>(
					['playwright-status'],
					message.status
				);
			}
		},
		[queryClient]
	);

	// Set up message listener to update query cache and resolve promises
	React.useEffect(() => {
		window.addEventListener('message', handleMessage);

		// Notify extension that webview is ready
		vscode.postMessage({
			command: WebviewMessages.ready,
		});

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	}, [vscode, handleMessage]);

	// Query for Playwright status
	const {
		data: playwrightStatus,
		isLoading,
		error: queryError,
	} = useQuery<PlaywrightStatusData, Error>({
		queryKey: ['playwright-status'],
		queryFn: async () => {
			const message = await createMessagePromise(
				vscode,
				WebviewMessages.refreshStatus,
				WebviewMessages.playwrightStatus
			);
			if (!message.status) {
				throw new Error('No status received');
			}
			return message.status;
		},
		refetchInterval: false,
	});

	// Handle successful setup - refetch status
	const handleSetupSuccess = useCallback(() => {
		// Refetch status after successful setup
		// The file watcher should trigger an update, but we'll also manually refetch
		setTimeout(() => {
			queryClient.invalidateQueries({ queryKey: ['playwright-status'] });
		}, 3000);
	}, [queryClient]);

	// Mutation for setting up Playwright
	const setupMutation = useMutation({
		mutationFn: async (targetDirectory?: string): Promise<void> => {
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					window.removeEventListener('message', handler);
					reject(new Error('Setup timeout'));
				}, 60000); // 60 seconds for setup

				const handler = (event: MessageEvent) => {
					const message = event.data as MessageData;
					if (message.command === WebviewMessages.setupError) {
						clearTimeout(timeout);
						window.removeEventListener('message', handler);
						reject(new Error(message.error || 'Setup failed'));
					} else if (message.command === WebviewMessages.setupStart) {
						// Setup started successfully
						// The status will be refreshed automatically via file watcher
						// Wait a bit then resolve - status update will come via query cache
						setTimeout(() => {
							clearTimeout(timeout);
							window.removeEventListener('message', handler);
							resolve();
						}, 1000);
					}
				};

				window.addEventListener('message', handler);
				vscode.postMessage({
					command: WebviewMessages.setupPlaywright,
					targetDirectory,
				});
			});
		},
		onSuccess: handleSetupSuccess,
	});

	const handleSetup = (targetDirectory?: string) => {
		setupMutation.mutate(targetDirectory);
	};

	const error = queryError?.message || setupMutation.error?.message;

	return (
		<div className="w-full h-full overflow-auto">
			{isLoading && !playwrightStatus ? (
				<Welcome />
			) : playwrightStatus ? (
				<PlaywrightStatus
					status={playwrightStatus}
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

