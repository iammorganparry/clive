/**
 * API URLs used for backend communication
 */
export const ApiUrls = {
  dashboard: "http://localhost:3000",
  trpc: "http://localhost:3000/api/trpc",
} as const;

/**
 * Command IDs used throughout the extension
 */
export const Commands = {
  showView: "clive.showView",
  helloWorld: "clive.helloWorld",
  approvePlan: "clive.approvePlan",
  rejectPlan: "clive.rejectPlan",
  sendApproval: "clive.sendApproval",
  refreshCodeLens: "clive.refreshCodeLens",
} as const;

/**
 * View IDs used throughout the extension
 */
export const Views = {
  mainView: "clive.mainView",
  viewContainer: "clive",
} as const;

/**
 * Secret storage keys used for encrypted storage
 */
export const SecretKeys = {
  anthropicApiKey: "clive.anthropic_api_key",
  firecrawlApiKey: "clive.firecrawl_api_key",
  authToken: "clive.auth_token",
  userInfo: "clive.user_info",
  gatewayToken: "clive.gateway_token",
  gatewayTokenExpiry: "clive.gateway_token_expiry",
} as const;

/**
 * Webview message commands for communication between extension and webview
 * Most communication now uses RPC - these are only for low-level messages
 */
export const WebviewMessages = {
  ready: "ready",
  themeInfo: "theme-info",
  themeChange: "theme-change",
  log: "log",
} as const;

/**
 * Logger configuration constants
 */
export const LoggerConfig = {
  prefix: "Clive",
} as const;

/**
 * Configuration file constants
 */
export const ConfigFile = {
  filename: "clive.config.json",
  defaults: {
    maxConcurrentFiles: 3,
  },
} as const;

/**
 * Indexing configuration constants
 */
export const IndexingConfig = {
  /** Debounce time in ms - wait after last change before indexing a file */
  debounceMs: 10000,
  /** Batch processor interval in ms - how often to check for files ready to index */
  batchIntervalMs: 5000,
} as const;

/**
 * GlobalState keys for persistent user preferences
 */
export const GlobalStateKeys = {
  /** Whether the user has completed onboarding */
  onboardingComplete: "clive.onboardingComplete",
} as const;

/**
 * Suggested knowledge base categories (examples, not enforced)
 * Agents can create articles with any category name that makes sense for the codebase
 */
export const SuggestedKnowledgeCategories = [
  "architecture",
  "user-journeys",
  "components",
  "data-models",
  "api-integrations",
  "testing-patterns",
  "test-execution",
  "framework",
  "patterns",
  "mocks",
  "fixtures",
  "selectors",
  "routes",
  "assertions",
  "hooks",
  "utilities",
  "coverage",
  "gaps",
  "improvements",
  "error-handling",
  "brittle-code",
  "security",
  "environment",
  "state-management",
  "code-activity",
  "active-development-areas",
] as const;

/**
 * Knowledge base category type - accepts any string
 * Agents have freedom to create categories that make sense for each codebase
 */
export type KnowledgeBaseCategory = string;

/**
 * Zod schema for knowledge base categories
 * Accepts any string to allow agent-driven organization
 */
import { z } from "zod";

export const KnowledgeBaseCategorySchema = z.string();
