/**
 * Centralized Service Layer Factory
 *
 * Provides a single source of truth for Effect-TS layer composition.
 * All RPC routers should use these factories instead of manually composing layers.
 *
 * Tier Architecture:
 * - Tier 0 (Core): VSCodeService, SecretStorage, Logger - context-dependent
 * - Tier 1 (Base): ConfigService, ApiKeyService - common business logic
 * - Tier 2 (Domain): RepositoryService, ConversationService, ReactFileFilter
 * - Tier 3 (Features): CodebaseIndexing, Agents
 */

import { Layer } from "effect";
import type * as vscode from "vscode";
import { VSCodeService, createSecretStorageLayer } from "./vs-code.js";
import { createLoggerLayer } from "./logger-service.js";
import { ConfigServiceLive } from "./config-service.js";
import { ApiKeyServiceLive } from "./api-key-service.js";
import { RepositoryServiceLive } from "./repository-service.js";
import { CodebaseIndexingServiceLive } from "./codebase-indexing-service.js";
import { ConversationServiceLive } from "./conversation-service.js";
import { ReactFileFilterLive } from "./react-file-filter.js";
import { CypressTestAgentLive } from "./ai-agent/agent.js";
import { PlanningAgentLive } from "./ai-agent/planning-agent.js";

/**
 * Context required to create the core layer
 */
export interface LayerContext {
  extensionContext: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  isDev: boolean;
}

/**
 * Tier 0: Core Layer
 * Always required, context-dependent services
 */
export function createCoreLayer(ctx: LayerContext) {
  return Layer.mergeAll(
    VSCodeService.Default,
    createSecretStorageLayer(ctx.extensionContext),
    createLoggerLayer(ctx.outputChannel, ctx.isDev),
  );
}

/**
 * Tier 1: Base Layer
 * Common business services that most handlers need
 * Uses *Live layers with all dependencies composed
 */
export const BaseServiceLayer = Layer.mergeAll(
  ConfigServiceLive,
  ApiKeyServiceLive,
);

/**
 * Tier 2: Domain Layers
 * Specific domain services - include as needed
 * Uses *Live layers with all dependencies composed
 */
export const RepositoryLayer = RepositoryServiceLive;
export const ConversationLayer = ConversationServiceLive;
export const ReactFileFilterLayer = ReactFileFilterLive;

/**
 * Tier 3: Feature Layers
 * High-level feature services
 * Uses *Live layers with all dependencies composed
 */
export const IndexingLayer = CodebaseIndexingServiceLive;
export const AgentLayer = Layer.mergeAll(
  CypressTestAgentLive,
  PlanningAgentLive,
);

/**
 * Convenience: Config + Indexing layer
 * For config router and similar handlers
 */
export function createConfigServiceLayer(ctx: LayerContext) {
  return Layer.mergeAll(
    createCoreLayer(ctx),
    BaseServiceLayer,
    RepositoryLayer,
    IndexingLayer,
  );
}

/**
 * Convenience: Agent layer with all dependencies
 * For agent router and similar handlers
 */
export function createAgentServiceLayer(ctx: LayerContext) {
  return Layer.mergeAll(
    createCoreLayer(ctx),
    BaseServiceLayer,
    AgentLayer,
    ConversationLayer,
  );
}

/**
 * Convenience: Auth layer (minimal)
 * For auth router
 */
export function createAuthServiceLayer(ctx: LayerContext) {
  return Layer.mergeAll(createCoreLayer(ctx), BaseServiceLayer);
}

/**
 * Convenience: System layer
 * For system router
 */
export function createSystemServiceLayer(ctx: LayerContext) {
  return Layer.mergeAll(
    createCoreLayer(ctx),
    BaseServiceLayer,
    ReactFileFilterLayer,
  );
}

/**
 * Convenience: Full layer with everything
 * Use sparingly - prefer specific layers
 */
export function createFullServiceLayer(ctx: LayerContext) {
  return Layer.mergeAll(
    createCoreLayer(ctx),
    BaseServiceLayer,
    RepositoryLayer,
    ConversationLayer,
    ReactFileFilterLayer,
    IndexingLayer,
    AgentLayer,
  );
}

/**
 * Helper to convert RpcContext to LayerContext
 */
export function toLayerContext(ctx: {
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  isDev: boolean;
}): LayerContext {
  return {
    extensionContext: ctx.context,
    outputChannel: ctx.outputChannel,
    isDev: ctx.isDev,
  };
}
