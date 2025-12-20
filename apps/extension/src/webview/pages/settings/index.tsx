import type React from "react";
import type { VSCodeAPI } from "../../services/vscode.js";
import { ApiKeyForm } from "./components/api-key-form.js";

interface SettingsPageProps {
  vscode: VSCodeAPI;
  pendingPromises: Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >;
  createMessagePromise: (
    vscode: VSCodeAPI,
    command: string,
    expectedResponseCommand: string,
  ) => Promise<unknown>;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  vscode,
  pendingPromises,
  createMessagePromise,
}) => {
  return (
    <div className="w-full h-full p-4 space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your API keys for various providers
        </p>
      </div>

      <ApiKeyForm
        vscode={vscode}
        pendingPromises={pendingPromises}
        createMessagePromise={createMessagePromise}
      />
    </div>
  );
};
