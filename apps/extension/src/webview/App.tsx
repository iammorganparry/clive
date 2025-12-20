import type React from "react";
import { useCallback, useEffect } from "react";
import type { VSCodeAPI } from "./services/vscode.js";
import { WebviewMessages } from "../constants.js";
import { logger } from "./services/logger.js";
import { useAuth } from "./contexts/auth-context.js";
import { useRouter, Routes } from "./router/index.js";
import { Header } from "./components/layout/header.js";
import { LoginPage } from "./pages/login/index.js";
import { DashboardPage } from "./pages/dashboard/index.js";
import { SettingsPage } from "./pages/settings/index.js";

interface AppProps {
  vscode: VSCodeAPI;
}

interface MessageData {
  command: string;
  [key: string]: unknown;
}

// Store pending promises for message responses (shared across pages)
const pendingPromises = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

// Create a Promise-based message system (shared across pages)
const createMessagePromise = (
  vscode: VSCodeAPI,
  command: string,
  expectedResponseCommand: string,
): Promise<unknown> => {
  return new Promise<unknown>((resolve, reject) => {
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
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { route } = useRouter();

  // Handle incoming messages from extension (for resolving promises)
  const handleMessage = useCallback((event: MessageEvent) => {
    const message = event.data as MessageData;
    logger.message.receive(message.command, message);

    // Check if there's a pending promise for this command
    const pending = pendingPromises.get(message.command);
    if (pending) {
      if (message.error) {
        pending.reject(new Error(message.error as string));
      } else {
        pending.resolve(message);
      }
    }
  }, []);

  // Set up message listener
  useEffect(() => {
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

  // Render page based on route
  const renderPage = () => {
    if (route === Routes.login) {
      return <LoginPage />;
    }

    if (route === Routes.settings) {
      return (
        <SettingsPage
          vscode={vscode}
          pendingPromises={pendingPromises}
          createMessagePromise={createMessagePromise}
        />
      );
    }

    // Default to dashboard
    return (
      <DashboardPage
        vscode={vscode}
        pendingPromises={pendingPromises}
        createMessagePromise={createMessagePromise}
      />
    );
  };

  return (
    <div className="w-full h-full flex flex-col bg-background text-foreground">
      {isAuthenticated && !authLoading && <Header />}
      <div className="flex-1 overflow-auto">{renderPage()}</div>
    </div>
  );
};

export default App;
