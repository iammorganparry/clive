/**
 * Slack App Runtime
 *
 * Unified Effect runtime for the Slack application.
 * Provides a managed runtime with all service layers composed.
 */

import { ClaudeCliService } from "@clive/claude-services";
import { Layer, ManagedRuntime } from "effect";

/**
 * Core layer with Claude CLI service
 * Additional services can be added here as the app grows
 */
const CoreLayer = Layer.mergeAll(ClaudeCliService.Default);

/**
 * Managed runtime for the Slack app
 * Provides automatic resource cleanup and unified execution context
 */
export const SlackAppRuntime = ManagedRuntime.make(CoreLayer);

/**
 * Run an Effect using the Slack app runtime
 */
export const runSlackEffect = SlackAppRuntime.runPromise;

/**
 * Run an Effect and return Exit (includes error info)
 */
export const runSlackEffectExit = SlackAppRuntime.runPromiseExit;

/**
 * Fork an Effect in the background
 */
export const forkSlackEffect = SlackAppRuntime.runFork;
