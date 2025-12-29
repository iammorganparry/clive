/**
 * Centralized Service Layer Factory
 *
 * Provides a single source of truth for Effect-TS layer composition.
 * All RPC routers should use these factories instead of manually composing layers.
 *
 * Tier Architecture:
 * - Tier 0 (Core): VSCodeService, SecretStorage, Logger - context-dependent
 * - Tier 1 (Base): ConfigService, ApiKeyService - common business logic
 * - Tier 2 (Domain): RepositoryService, ConversationService, SourceFileFilter
 * - Tier 3 (Features): CodebaseIndexing, Agents
 */

import { Layer } from "effect";
import type * as vscode from "vscode";
import { CompletionDetectorLive } from "./ai-agent/completion-detector.js";
import { KnowledgeBaseAgentLive } from "./ai-agent/knowledge-base-agent.js";
import { PromptServiceLive } from "./ai-agent/prompts/prompt-service.js";
import { RulesServiceLive } from "./ai-agent/prompts/rules-service.js";
import { SummaryServiceLive } from "./ai-agent/summary-service.js";
import { TestingAgentLive } from "./ai-agent/testing-agent.js";
import { ApiKeyServiceLive } from "./api-key-service.js";
import { ConfigServiceLive } from "./config-service.js";
import { ConversationServiceLive } from "./conversation-service.js";
import { DeviceAuthServiceLive } from "./device-auth-service.js";
import { GitServiceLive } from "./git-service.js";
import { KnowledgeBaseServiceLive } from "./knowledge-base-service.js";
import { KnowledgeFileServiceLive } from "./knowledge-file-service.js";
import { createLoggerLayer } from "./logger-service.js";
import { PlanFileService } from "./plan-file-service.js";
import { RepositoryServiceLive } from "./repository-service.js";
import {
  createSettingsServiceLayer,
  SettingsService,
} from "./settings-service.js";
import { SourceFileFilterLive } from "./source-file-filter.js";
import { TrpcClientServiceLive } from "./trpc-client-service.js";
import {
  createSecretStorageLayer,
  SecretStorageService,
  VSCodeService,
} from "./vs-code.js";

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
 * Create Tier 1: Base Layer
 * Common business services that most handlers need
 * Must be provided with core layer (SecretStorageService)
 */
export function createBaseLayer(coreLayer: ReturnType<typeof createCoreLayer>) {
  // ApiKeyService depends on SecretStorageService
  const apiKeyLayer = ApiKeyServiceLive.pipe(Layer.provide(coreLayer));

  // ConfigService depends on SecretStorageService and ApiKeyService
  const configLayer = ConfigServiceLive.pipe(
    Layer.provide(coreLayer),
    Layer.provide(apiKeyLayer),
  );

  // TrpcClientService depends on ConfigService
  const trpcClientLayer = TrpcClientServiceLive.pipe(
    Layer.provide(configLayer),
  );

  // SettingsService depends on extension context (from LayerContext)
  // We need to provide it separately in each router that needs it
  // For now, return base layer without SettingsService

  return Layer.mergeAll(coreLayer, apiKeyLayer, configLayer, trpcClientLayer);
}

/**
 * Create Tier 2: Domain Layers
 * Specific domain services - include as needed
 */
export function createDomainLayer(
  baseLayer: ReturnType<typeof createBaseLayer>,
  ctx?: LayerContext,
) {
  // RepositoryService depends on ConfigService
  const repoLayer = RepositoryServiceLive.pipe(Layer.provide(baseLayer));

  // ConversationService depends on ConfigService
  const convLayer = ConversationServiceLive.pipe(Layer.provide(baseLayer));

  // SourceFileFilter depends on VSCodeService (in baseLayer via coreLayer)
  const sourceFilterLayer = SourceFileFilterLive.pipe(Layer.provide(baseLayer));

  // SettingsService depends on extension context
  // GitService depends on VSCodeService and SettingsService
  if (ctx?.extensionContext) {
    const settingsLayer = Layer.effect(
      SettingsService,
      createSettingsServiceLayer(ctx.extensionContext),
    );
    const gitLayer = GitServiceLive.pipe(
      Layer.provide(Layer.mergeAll(baseLayer, settingsLayer)),
    );

    return Layer.mergeAll(
      baseLayer,
      repoLayer,
      convLayer,
      sourceFilterLayer,
      settingsLayer,
      gitLayer,
    );
  }

  // Fallback: GitService without SettingsService (will use auto-detect only)
  const gitLayer = GitServiceLive.pipe(Layer.provide(baseLayer));

  return Layer.mergeAll(
    baseLayer,
    repoLayer,
    convLayer,
    sourceFilterLayer,
    gitLayer,
  );
}

/**
 * Create Tier 3: Feature Layers
 * High-level feature services
 */
export function createFeatureLayer(
  domainLayer: ReturnType<typeof createDomainLayer>,
) {
  // TestingAgent depends on VSCodeService, ConfigService
  const testingLayer = TestingAgentLive.pipe(Layer.provide(domainLayer));

  return Layer.mergeAll(domainLayer, testingLayer);
}

/**
 * Convenience: Config layer
 * For config router and similar handlers
 */
export function createConfigServiceLayer(ctx: LayerContext) {
  const coreLayer = createCoreLayer(ctx);
  const baseLayer = createBaseLayer(coreLayer);
  const domainLayer = createDomainLayer(baseLayer, ctx);

  // KnowledgeFileService depends on VSCodeService (in baseLayer via coreLayer)
  const knowledgeFileLayer = KnowledgeFileServiceLive.pipe(
    Layer.provide(baseLayer),
  );

  // KnowledgeBaseAgent depends on ConfigService, RepositoryService, and KnowledgeFileService
  const knowledgeBaseAgentLayer = KnowledgeBaseAgentLive.pipe(
    Layer.provide(Layer.mergeAll(domainLayer, knowledgeFileLayer)),
  );

  // KnowledgeBaseService depends on KnowledgeBaseAgent and KnowledgeFileService
  const knowledgeBaseServiceLayer = KnowledgeBaseServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(domainLayer, knowledgeBaseAgentLayer, knowledgeFileLayer),
    ),
  );

  return Layer.mergeAll(
    domainLayer,
    knowledgeFileLayer,
    knowledgeBaseAgentLayer,
    knowledgeBaseServiceLayer,
  );
}

/**
 * Convenience: Agent layer with all dependencies
 * For agent router and similar handlers
 */
export function createAgentServiceLayer(ctx: LayerContext) {
  const coreLayer = createCoreLayer(ctx);
  const baseLayer = createBaseLayer(coreLayer);
  const domainLayer = createDomainLayer(baseLayer, ctx);

  // PlanFileService depends on VSCodeService (in baseLayer via coreLayer)
  const planFileLayer = PlanFileService.Default.pipe(Layer.provide(baseLayer));

  // Domain layer with plan file service
  const domainWithServices = Layer.mergeAll(domainLayer, planFileLayer);

  // KnowledgeFileService depends on VSCodeService (in baseLayer via coreLayer)
  const knowledgeFileLayer = KnowledgeFileServiceLive.pipe(
    Layer.provide(baseLayer),
  );

  // KnowledgeBaseAgent depends on ConfigService, RepositoryService, and KnowledgeFileService
  const knowledgeBaseAgentLayer = KnowledgeBaseAgentLive.pipe(
    Layer.provide(Layer.mergeAll(domainLayer, knowledgeFileLayer)),
  );

  // KnowledgeBaseService depends on KnowledgeBaseAgent and KnowledgeFileService
  const knowledgeBaseServiceLayer = KnowledgeBaseServiceLive.pipe(
    Layer.provide(
      Layer.mergeAll(domainLayer, knowledgeBaseAgentLayer, knowledgeFileLayer),
    ),
  );

  // SummaryService has no dependencies - can be added directly
  const summaryServiceLayer = SummaryServiceLive;

  // CompletionDetector has no dependencies - can be added directly
  const completionDetectorLayer = CompletionDetectorLive;

  // RulesService has no dependencies - can be added directly
  const rulesServiceLayer = RulesServiceLive;

  // PromptService depends on RulesService
  const promptServiceLayer = PromptServiceLive.pipe(
    Layer.provide(rulesServiceLayer),
  );

  // Domain layer with all services including knowledge base and summary service
  const domainWithAllServices = Layer.mergeAll(
    domainWithServices,
    knowledgeFileLayer,
    knowledgeBaseAgentLayer,
    knowledgeBaseServiceLayer,
    summaryServiceLayer,
    completionDetectorLayer,
    rulesServiceLayer,
    promptServiceLayer,
  );

  // Add agent layers
  // TestingAgent depends on PlanFileService, KnowledgeBaseService, and SummaryService
  const testingLayer = TestingAgentLive.pipe(
    Layer.provide(domainWithAllServices),
  );

  return Layer.mergeAll(domainWithAllServices, testingLayer);
}

/**
 * Convenience: Auth layer (minimal)
 * For auth router - includes DeviceAuthService for device authorization flow
 */
export function createAuthServiceLayer(ctx: LayerContext) {
  const coreLayer = createCoreLayer(ctx);
  const baseLayer = createBaseLayer(coreLayer);

  // DeviceAuthService depends on ConfigService (in baseLayer)
  const deviceAuthLayer = DeviceAuthServiceLive.pipe(Layer.provide(baseLayer));

  return Layer.mergeAll(baseLayer, deviceAuthLayer);
}

/**
 * Convenience: System layer
 * For system router
 */
export function createSystemServiceLayer(ctx: LayerContext) {
  const coreLayer = createCoreLayer(ctx);
  const baseLayer = createBaseLayer(coreLayer);
  const domainLayer = createDomainLayer(baseLayer, ctx);
  return domainLayer;
}

/**
 * Convenience: Full layer with everything
 * Use sparingly - prefer specific layers
 */
export function createFullServiceLayer(ctx: LayerContext) {
  const coreLayer = createCoreLayer(ctx);
  const baseLayer = createBaseLayer(coreLayer);
  const domainLayer = createDomainLayer(baseLayer);
  return createFeatureLayer(domainLayer);
}

/**
 * Create a SecretStorageService layer from an existing service instance
 * Useful for tools that need to provide the layer when running Effects
 */
export function createSecretStorageLayerFromService(
  secretStorageService: SecretStorageService,
) {
  return Layer.succeed(SecretStorageService, secretStorageService);
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
