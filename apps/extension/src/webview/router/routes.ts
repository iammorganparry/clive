/**
 * Route definitions for the webview router
 */
export const Routes = {
  login: "/login",
  dashboard: "/",
  settings: "/settings",
} as const;

export type Route = (typeof Routes)[keyof typeof Routes];
