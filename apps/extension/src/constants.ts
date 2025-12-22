/**
 * Command IDs used throughout the extension
 */
export const Commands = {
  showView: "clive.showView",
  helloWorld: "clive.helloWorld",
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
