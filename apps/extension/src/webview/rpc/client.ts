/**
 * RPC client configuration and types for the webview
 *
 * This module provides the client-side types and utilities for
 * communicating with the extension's RPC router.
 */

import type { AppRouter } from "../../rpc/router.js";

/**
 * Re-export the router type for use in the webview
 */
export type { AppRouter };

/**
 * RPC path types - these match the router structure
 */
export const RpcPaths = {
  status: {
    cypress: ["status", "cypress"],
    branchChanges: ["status", "branchChanges"],
  },
  agents: {
    planTests: ["agents", "planTests"],
    generateTest: ["agents", "generateTest"],
  },
} as const;

/**
 * Type helpers for input/output inference
 */
export type StatusCypressOutput = {
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
};

export type BranchChangesOutput = {
  branchName: string;
  baseBranch: string;
  files: Array<{
    path: string;
    relativePath: string;
    status: "M" | "A" | "D" | "R";
    isEligible: boolean;
    reason?: string;
  }>;
  workspaceRoot: string;
} | null;

export type PlanTestsInput = {
  files: string[];
};

export type PlanTestsOutput = {
  tests: Array<{
    id: string;
    sourceFile: string;
    targetTestPath: string;
    description: string;
    isUpdate: boolean;
    proposedContent: string;
    existingContent?: string;
  }>;
  error?: string;
};

export type GenerateTestInput = {
  sourceFilePath: string;
};

export type GenerateTestProgress = {
  status: "starting" | "generating";
  message: string;
};

export type GenerateTestOutput =
  | { success: true; testFilePath?: string; testContent?: string }
  | { success: false; error: string };
