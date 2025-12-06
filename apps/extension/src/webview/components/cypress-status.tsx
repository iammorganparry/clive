import type React from "react";
import { Alert, AlertDescription } from "../../components/ui/alert.js";

interface CypressStatusProps {
  status: {
    overallStatus: "installed" | "not_installed" | "partial";
    packages: Array<unknown>;
    workspaceRoot: string;
  };
  error?: string;
}

const CypressStatus: React.FC<CypressStatusProps> = ({ status, error }) => {
  const { overallStatus } = status;

  // Only show warning if Cypress is not fully installed
  if (overallStatus === "installed") {
    return null;
  }

  const getStatusText = () => {
    switch (overallStatus) {
      case "partial":
        return "Cypress is partially installed. Please ensure Cypress is fully configured.";
      case "not_installed":
        return "Cypress is not installed. Please install Cypress to use this extension.";
      default:
        return "";
    }
  };

  return (
    <Alert
      variant={overallStatus === "not_installed" ? "destructive" : "default"}
      className="m-4"
    >
      <AlertDescription className="flex items-center gap-2">
        <span className="text-lg">⚠</span>
        <span>{getStatusText()}</span>
      </AlertDescription>
      {error && (
        <AlertDescription className="mt-2 text-sm text-muted-foreground">
          {error}
        </AlertDescription>
      )}
    </Alert>
  );
};

export default CypressStatus;
