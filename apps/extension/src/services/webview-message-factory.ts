import { WebviewMessages } from "../constants.js";
import type { ProposedTest, TestExecutionStatus } from "./ai-agent/types.js";
import type { CypressStatus } from "./cypress-detector.js";
import type { BranchChangesData } from "../webview/components/branch-changes.js";

/**
 * Type definitions for webview messages
 */
export interface AuthTokenMessage {
  command: typeof WebviewMessages.authToken;
  token: string;
}

export interface CypressStatusMessage {
  command: typeof WebviewMessages.cypressStatus;
  status: CypressStatus;
  error?: string;
}

export interface BranchChangesStatusMessage {
  command: typeof WebviewMessages.branchChangesStatus;
  changes: BranchChangesData | null;
  error?: string;
}

export interface TestGenerationStatusMessage {
  command: typeof WebviewMessages.testGenerationStatus;
  success: boolean;
  filePath: string;
  testFilePath?: string;
  testContent?: string;
  error?: string;
}

export interface TestGenerationProgressMessage {
  command: typeof WebviewMessages.testGenerationProgress;
  filePath: string;
  status: "starting" | "planning" | "executing" | "completed" | "error";
  message: string;
}

export interface TestGenerationPlanMessage {
  command: typeof WebviewMessages.testGenerationPlan;
  tests: ProposedTest[];
  error?: string;
}

export interface TestExecutionUpdateMessage {
  command: typeof WebviewMessages.testExecutionUpdate;
  id: string;
  executionStatus: TestExecutionStatus;
  testFilePath?: string;
  message?: string;
  error?: string;
}

export interface OAuthCallbackMessage {
  command: typeof WebviewMessages.oauthCallback;
  error?: string;
}

export interface ThemeInfoMessage {
  command: typeof WebviewMessages.themeInfo;
  colorScheme: "light" | "dark";
}

export type WebviewMessage =
  | AuthTokenMessage
  | CypressStatusMessage
  | BranchChangesStatusMessage
  | TestGenerationStatusMessage
  | TestGenerationProgressMessage
  | TestGenerationPlanMessage
  | TestExecutionUpdateMessage
  | OAuthCallbackMessage
  | ThemeInfoMessage;

/**
 * Factory for creating type-safe webview messages
 */
export const WebviewMessageFactory = {
  /**
   * Create an auth token message
   */
  authToken(token: string): AuthTokenMessage {
    return {
      command: WebviewMessages.authToken,
      token,
    };
  },

  /**
   * Create a Cypress status message
   */
  cypressStatus(status: CypressStatus, error?: string): CypressStatusMessage {
    return {
      command: WebviewMessages.cypressStatus,
      status,
      ...(error && { error }),
    };
  },

  /**
   * Create a branch changes status message
   */
  branchChangesStatus(
    changes: BranchChangesData | null,
    error?: string,
  ): BranchChangesStatusMessage {
    return {
      command: WebviewMessages.branchChangesStatus,
      changes,
      ...(error && { error }),
    };
  },

  /**
   * Create a test generation status message
   */
  testGenerationStatus(
    success: boolean,
    filePath: string,
    options?: {
      testFilePath?: string;
      testContent?: string;
      error?: string;
    },
  ): TestGenerationStatusMessage {
    return {
      command: WebviewMessages.testGenerationStatus,
      success,
      filePath,
      ...(options?.testFilePath && { testFilePath: options.testFilePath }),
      ...(options?.testContent && { testContent: options.testContent }),
      ...(options?.error && { error: options.error }),
    };
  },

  /**
   * Create a test generation progress message
   */
  testGenerationProgress(
    filePath: string,
    status: "starting" | "planning" | "executing" | "completed" | "error",
    message: string,
  ): TestGenerationProgressMessage {
    return {
      command: WebviewMessages.testGenerationProgress,
      filePath,
      status,
      message,
    };
  },

  /**
   * Create a test generation plan message
   */
  testGenerationPlan(
    tests: ProposedTest[],
    error?: string,
  ): TestGenerationPlanMessage {
    return {
      command: WebviewMessages.testGenerationPlan,
      tests,
      ...(error && { error }),
    };
  },

  /**
   * Create a test execution update message
   */
  testExecutionUpdate(
    id: string,
    executionStatus: TestExecutionStatus,
    options?: {
      testFilePath?: string;
      message?: string;
      error?: string;
    },
  ): TestExecutionUpdateMessage {
    return {
      command: WebviewMessages.testExecutionUpdate,
      id,
      executionStatus,
      ...(options?.testFilePath && { testFilePath: options.testFilePath }),
      ...(options?.message && { message: options.message }),
      ...(options?.error && { error: options.error }),
    };
  },

  /**
   * Create an OAuth callback message
   */
  oauthCallback(error?: string): OAuthCallbackMessage {
    return {
      command: WebviewMessages.oauthCallback,
      ...(error && { error }),
    };
  },

  /**
   * Create a theme info message
   */
  themeInfo(colorScheme: "light" | "dark"): ThemeInfoMessage {
    return {
      command: WebviewMessages.themeInfo,
      colorScheme,
    };
  },
} as const;
