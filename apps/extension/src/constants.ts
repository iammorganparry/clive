/**
 * Command IDs used throughout the extension
 */
export const Commands = {
  showView: "clive.showView",
  helloWorld: "clive.helloWorld",
  setupCypress: "clive.setupCypress",
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
  setupCypress: "setup-cypress",
  cypressStatus: "cypress-status",
  setupStart: "setup-start",
  setupError: "setup-error",
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
} as const;
