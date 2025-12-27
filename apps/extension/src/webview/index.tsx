import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./index.css";
import { initializeTheme, updateTheme } from "./services/theme-service.js";
import { WebviewMessages } from "../constants.js";
import { initLogger } from "./services/logger.js";
import { getVSCodeAPI } from "./services/vscode.js";
import { AuthProvider } from "./contexts/auth-context.js";
import { ComparisonModeProvider } from "./contexts/comparison-mode-context.js";
import { RouterProvider } from "./router/index.js";
import { RpcProvider } from "./rpc/provider.js";

// Only load react-grab in development
if (import.meta.env.DEV) {
  import("react-grab");
}

const vscode = getVSCodeAPI();

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
    <QueryClientProvider client={queryClient}>
      <RpcProvider vscode={vscode}>
        <AuthProvider>
          <ComparisonModeProvider>
            <RouterProvider>
              <App vscode={vscode} />
            </RouterProvider>
          </ComparisonModeProvider>
        </AuthProvider>
      </RpcProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
