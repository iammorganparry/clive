import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./index.css";
import { initializeTheme, updateTheme } from "./services/theme-service.js";
import { WebviewMessages } from "../constants.js";

// Acquire VS Code API
declare const acquireVsCodeApi: () => {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

const vscode = acquireVsCodeApi();

// Initialize theme service before React renders
initializeTheme();

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

// Create root and render
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App vscode={vscode} />
    </QueryClientProvider>
  </React.StrictMode>,
);
