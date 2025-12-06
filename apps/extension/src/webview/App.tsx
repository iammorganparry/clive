import React, { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import Welcome from "./components/welcome.js";
import CypressStatus from "./components/cypress-status.js";
import BranchChanges from "./components/branch-changes.js";
import { Login } from "./components/login.js";
import { Button } from "../components/ui/button.js";
import { WebviewMessages } from "../constants.js";
import { logger } from "./services/logger.js";
import type { VSCodeAPI } from "./services/vscode.js";
import { useAuth } from "./contexts/auth-context.js";
import type { BranchChangesData } from "./components/branch-changes.js";

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
  changes?: BranchChangesData | null;
  error?: string;
  targetDirectory?: string;
  filePath?: string;
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
  expectedResponseCommand: string,
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
  const { isAuthenticated, isLoading: authLoading, token, logout } = useAuth();

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
          message.status,
        );
      }

      // Update the query cache with branch changes
      if (
        message.command === WebviewMessages.branchChangesStatus &&
        message.changes !== undefined
      ) {
        queryClient.setQueryData<BranchChangesData | null>(
          ["branch-changes"],
          message.changes,
        );
      }
    },
    [queryClient],
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
          WebviewMessages.cypressStatus,
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

  // Query for branch changes (only when authenticated)
  const {
    data: branchChanges,
    isLoading: branchChangesLoading,
    error: branchChangesError,
  } = useQuery<BranchChangesData | null, Error>({
    queryKey: ["branch-changes"],
    queryFn: async () => {
      logger.query.start("branch-changes");
      try {
        const message = await createMessagePromise(
          vscode,
          WebviewMessages.getBranchChanges,
          WebviewMessages.branchChangesStatus,
        );

        logger.query.success("branch-changes", message.changes);
        return message.changes ?? null;
      } catch (error) {
        logger.query.error("branch-changes", error);
        throw error;
      }
    },
    refetchInterval: false,
    enabled: isAuthenticated && !authLoading, // Only fetch when authenticated
  });

  const handleLoginSuccess = useCallback(() => {
    // AuthContext handles login state automatically
    // Token is already set, so we can proceed
  }, []);

  // Handler for creating test for a single file
  const handleCreateTestForFile = useCallback(
    (filePath: string) => {
      vscode.postMessage({
        command: WebviewMessages.createTestForFile,
        filePath,
      });
    },
    [vscode],
  );

  // Handler for creating tests for all changed files
  const handleCreateAllTests = useCallback(() => {
    if (branchChanges?.files) {
      for (const file of branchChanges.files) {
        vscode.postMessage({
          command: WebviewMessages.createTestForFile,
          filePath: file.path,
        });
      }
    }
  }, [branchChanges, vscode]);

  return (
    <div className="w-full h-full flex flex-col bg-background text-foreground">
      {isAuthenticated && (
        <div className="flex items-center justify-end border-b border-border px-4 py-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            title="Logout"
            className="h-8 w-8"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {!isAuthenticated && !authLoading ? (
          <Login onLoginSuccess={handleLoginSuccess} />
        ) : isLoading && !cypressStatus ? (
          <Welcome />
        ) : cypressStatus ? (
          <div className="w-full">
            <BranchChanges
              changes={branchChanges ?? null}
              isLoading={branchChangesLoading}
              error={branchChangesError?.message}
              onCreateTest={handleCreateTestForFile}
              onCreateAllTests={handleCreateAllTests}
            />
          </div>
        ) : (
          <Welcome />
        )}
      </div>
    </div>
  );
};

export default App;
