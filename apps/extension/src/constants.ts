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
 * Webview message commands for communication between extension and webview
 */
export const WebviewMessages = {
  ready: "ready",
  refreshStatus: "refresh-status",
  cypressStatus: "cypress-status",
  themeInfo: "theme-info",
  themeChange: "theme-change",
  // Auth messages
  checkSession: "check-session",
  sessionStatus: "session-status",
  login: "login",
  loginSuccess: "login-success",
  loginError: "login-error",
  logout: "logout",
  oauthCallback: "oauth-callback",
  startOAuth: "start-oauth",
  authToken: "auth-token",
  openLoginPage: "open-login-page",
  openSignupPage: "open-signup-page",
  authTokenReceived: "auth-token-received",
  // Logging
  log: "log",
  // Branch changes
  getBranchChanges: "get-branch-changes",
  branchChangesStatus: "branch-changes-status",
  createTestForFile: "create-test-for-file",
  testGenerationStatus: "test-generation-status",
  testGenerationProgress: "test-generation-progress",
  // Test generation planning and execution
  planTestGeneration: "plan-test-generation",
  testGenerationPlan: "test-generation-plan",
  confirmTestPlan: "confirm-test-plan",
  testExecutionUpdate: "test-execution-update",
} as const;
