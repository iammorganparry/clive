/**
 * @clive/claude-services
 * Shared services for Claude CLI integration
 */

export {
  ClaudeCliService,
  ClaudeCliServiceLive,
  ClaudeCliNotFoundError,
  ClaudeCliNotAuthenticatedError,
  ClaudeCliExecutionError,
  type ClaudeCliStatus,
  type ClaudeCliEvent,
  type ClaudeCliExecuteOptions,
  type CliExecutionHandle,
} from "./claude-cli-service.js";

export {
  BeadsService,
  BeadsServiceLive,
  BeadsNotFoundError,
  BeadsExecutionError,
  type BeadsIssue,
  type BeadsCreateOptions,
  type BeadsUpdateOptions,
  type BeadsListOptions,
  type BeadsStats,
} from "./beads-service.js";

export {
  LinearService,
  makeLinearServiceLive,
  LinearNotConfiguredError,
  LinearApiError,
  type LinearIssue,
  type LinearTeam,
  type LinearProject,
  type LinearWorkflowState,
  type LinearCreateIssueOptions,
  type LinearUpdateIssueOptions,
  type LinearListIssuesOptions,
  type LinearConfig,
} from "./linear-service.js";
