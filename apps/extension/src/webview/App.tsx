import type React from "react";
import { useEffect } from "react";
import type { VSCodeAPI } from "./services/vscode.js";
import { WebviewMessages } from "../constants.js";
import { logger } from "./services/logger.js";
import { useAuth } from "./contexts/auth-context.js";
import { useRouter, Routes } from "./router/index.js";
import { Header } from "./components/layout/header.js";
import { LoginPage } from "./pages/login/index.js";
import { DashboardPage } from "./pages/dashboard/index.js";
import { SettingsPage } from "./pages/settings/index.js";
import { OnboardingPage } from "./pages/onboarding/index.js";
import { InitializingScreen } from "./components/initializing-screen.js";

interface AppProps {
  vscode: VSCodeAPI;
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
  const { isAuthenticated } = useAuth();
  const { route, isInitializing } = useRouter();

  // Notify extension that webview is ready
  useEffect(() => {
    logger.info("Webview ready, notifying extension");
    logger.message.send(WebviewMessages.ready);
    vscode.postMessage({
      command: WebviewMessages.ready,
    });
  }, [vscode]);

  // Show loading screen while initializing
  if (isInitializing) {
    return <InitializingScreen />;
  }

  // Render page based on route
  const renderPage = () => {
    if (route === Routes.login) {
      return <LoginPage />;
    }

    if (route === Routes.onboarding) {
      return <OnboardingPage />;
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

  // Don't show header during login or onboarding
  const showHeader =
    isAuthenticated && route !== Routes.login && route !== Routes.onboarding;

  return (
    <div className="w-full h-full flex flex-col bg-background text-foreground">
      {showHeader && <Header />}
      <div className="flex-1 overflow-auto">{renderPage()}</div>
    </div>
  );
};

export default App;
