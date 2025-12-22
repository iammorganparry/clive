import { setup, assign } from "xstate";
import { Routes, type Route } from "./routes.js";

/**
 * Router state machine for managing initialization and navigation flow.
 *
 * States:
 * - initializing: Waiting for auth check to complete (shows loading)
 * - checkingOnboarding: Authenticated, fetching onboarding status (shows loading)
 * - unauthenticated: User not logged in (shows login page)
 * - needsOnboarding: Authenticated but onboarding incomplete (shows onboarding)
 * - ready: Fully initialized, ready for navigation (shows dashboard/settings)
 */
export const routerMachine = setup({
  types: {
    context: {} as {
      route: Route;
      isAuthenticated: boolean;
      onboardingComplete: boolean;
    },
    events: {} as
      | { type: "AUTH_RESULT"; isAuthenticated: boolean; token: string | null }
      | { type: "ONBOARDING_RESULT"; onboardingComplete: boolean }
      | { type: "LOGIN_SUCCESS" }
      | { type: "ONBOARDING_COMPLETE" }
      | { type: "LOGOUT" }
      | { type: "NAVIGATE"; route: Route },
  },
}).createMachine({
  id: "router",
  initial: "initializing",
  context: {
    route: Routes.dashboard,
    isAuthenticated: false,
    onboardingComplete: false,
  },
  states: {
    initializing: {
      on: {
        AUTH_RESULT: [
          {
            guard: ({ event }) => !event.isAuthenticated,
            target: "unauthenticated",
            actions: assign({ isAuthenticated: false }),
          },
          {
            target: "checkingOnboarding",
            actions: assign({ isAuthenticated: true }),
          },
        ],
      },
    },
    checkingOnboarding: {
      on: {
        ONBOARDING_RESULT: [
          {
            guard: ({ event }) => !event.onboardingComplete,
            target: "needsOnboarding",
            actions: assign({ onboardingComplete: false }),
          },
          {
            target: "ready",
            actions: assign({
              onboardingComplete: true,
              route: Routes.dashboard,
            }),
          },
        ],
      },
    },
    unauthenticated: {
      entry: assign({ route: Routes.login }),
      on: {
        LOGIN_SUCCESS: "checkingOnboarding",
      },
    },
    needsOnboarding: {
      entry: assign({ route: Routes.onboarding }),
      on: {
        ONBOARDING_COMPLETE: {
          target: "ready",
          actions: assign({
            onboardingComplete: true,
            route: Routes.dashboard,
          }),
        },
      },
    },
    ready: {
      on: {
        NAVIGATE: {
          actions: assign({ route: ({ event }) => event.route }),
        },
        LOGOUT: {
          target: "unauthenticated",
          actions: assign({
            isAuthenticated: false,
            onboardingComplete: false,
          }),
        },
      },
    },
  },
});

/**
 * Type for the router machine state
 */
export type RouterMachineState = ReturnType<
  typeof routerMachine.getInitialSnapshot
>;

/**
 * Type for the router machine events
 */
export type RouterMachineEvent =
  | { type: "AUTH_RESULT"; isAuthenticated: boolean; token: string | null }
  | { type: "ONBOARDING_RESULT"; onboardingComplete: boolean }
  | { type: "LOGIN_SUCCESS" }
  | { type: "ONBOARDING_COMPLETE" }
  | { type: "LOGOUT" }
  | { type: "NAVIGATE"; route: Route };
