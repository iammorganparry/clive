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
  authToken: "clive.auth_token",
  userInfo: "clive.user_info",
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
  /** Whether codebase indexing is enabled (opt-in) */
  indexingEnabled: "clive.indexingEnabled",
  /** Whether the user has completed onboarding */
  onboardingComplete: "clive.onboardingComplete",
} as const;

/**
 * Knowledge base categories
 */
export const KnowledgeBaseCategories = {
  framework: "framework",
  patterns: "patterns",
  mocks: "mocks",
  fixtures: "fixtures",
  selectors: "selectors",
  routes: "routes",
  assertions: "assertions",
  hooks: "hooks",
  utilities: "utilities",
  coverage: "coverage",
  gaps: "gaps",
  improvements: "improvements",
} as const;

export type KnowledgeBaseCategory =
  (typeof KnowledgeBaseCategories)[keyof typeof KnowledgeBaseCategories];

/**
 * Zod schema for knowledge base categories
 * Used for validation across extension and API layers
 */
import { z } from "zod";

export const KnowledgeBaseCategorySchema = z.enum([
  KnowledgeBaseCategories.framework,
  KnowledgeBaseCategories.patterns,
  KnowledgeBaseCategories.mocks,
  KnowledgeBaseCategories.fixtures,
  KnowledgeBaseCategories.selectors,
  KnowledgeBaseCategories.routes,
  KnowledgeBaseCategories.assertions,
  KnowledgeBaseCategories.hooks,
  KnowledgeBaseCategories.utilities,
  KnowledgeBaseCategories.coverage,
  KnowledgeBaseCategories.gaps,
  KnowledgeBaseCategories.improvements,
]);
