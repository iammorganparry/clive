/**
 * Route definitions for the webview router
 */
export const Routes = {
  login: "/login",
  dashboard: "/",
  settings: "/settings",
  onboarding: "/onboarding",
  changesetChat: "/changeset/chat",
} as const;

export type Route = (typeof Routes)[keyof typeof Routes];
