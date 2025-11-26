import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';

// Acquire VS Code API
declare const acquireVsCodeApi: () => {
	postMessage: (message: unknown) => void;
	getState: () => unknown;
	setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

// Create React Query client
const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			refetchOnWindowFocus: false,
			retry: false,
		},
	},
});

// Create root and render
const root = ReactDOM.createRoot(
	document.getElementById('root') as HTMLElement
);

root.render(
	<React.StrictMode>
		<QueryClientProvider client={queryClient}>
			<App vscode={vscode} />
		</QueryClientProvider>
	</React.StrictMode>
);

