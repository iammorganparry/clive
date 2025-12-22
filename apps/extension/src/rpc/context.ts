import type { Effect } from "effect";
import type * as vscode from "vscode";
import type { CypressDetector } from "../services/cypress-detector.js";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import type { BranchChanges } from "../services/git-service.js";
import type {
  LayerContext,
  createConfigServiceLayer,
  createAgentServiceLayer,
  createAuthServiceLayer,
  createSystemServiceLayer,
} from "../services/layer-factory.js";

/**
 * Layer types inferred from the layer factory functions for type safety
 */
export type ConfigLayerType = ReturnType<typeof createConfigServiceLayer>;
export type AgentLayerType = ReturnType<typeof createAgentServiceLayer>;
export type AuthLayerType = ReturnType<typeof createAuthServiceLayer>;
export type SystemLayerType = ReturnType<typeof createSystemServiceLayer>;

export interface GitServiceContext {
  getBranchChanges: () => Effect.Effect<BranchChanges | null>;
}

/**
 * RPC request context - provides access to extension services
 */
export interface RpcContext {
  // Core VS Code context
  webviewView: vscode.WebviewView;
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  isDev: boolean;

  // Extension services (classes/objects, not Effect services)
  cypressDetector: CypressDetector;
  gitService: GitServiceContext;
  diffProvider: DiffContentProvider;

  // Layer context for building default Effect layers
  layerContext: LayerContext;

  // Optional layer overrides - if provided, routers use these instead of defaults
  // This enables dependency injection for testing
  configLayer?: ConfigLayerType;
  agentLayer?: AgentLayerType;
  authLayer?: AuthLayerType;
  systemLayer?: SystemLayerType;
}
