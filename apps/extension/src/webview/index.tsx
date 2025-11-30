import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./index.css";
import { initializeTheme, updateTheme } from "./services/theme-service.js";
import { WebviewMessages } from "../constants.js";
import { initLogger } from "./services/logger.js";
import { getVSCodeAPI } from "./services/vscode.js";
import { AuthProvider } from "./contexts/AuthContext.js";

let vscode: ReturnType<typeof getVSCodeAPI>;
try {
  vscode = getVSCodeAPI();
} catch (error) {
  throw error;
}

try {
  initLogger(vscode);
} catch (_error) {
  // Continue without logger
}

try {
  initializeTheme();
} catch (_error) {
  // Continue if theme initialization fails
}

// Set up message listener for theme changes
window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    message.command === WebviewMessages.themeInfo ||
    message.command === WebviewMessages.themeChange
  ) {
    updateTheme({
      colorScheme: message.colorScheme,
    });
  }
});

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

const root = ReactDOM.createRoot(rootElement);


root.render(
	<React.StrictMode>
		<AuthProvider vscode={vscode}>
		<QueryClientProvider client={queryClient}>
		<App vscode={vscode} />
		</QueryClientProvider>
		</AuthProvider>
	</React.StrictMode>
);