import type { Context } from "effect";
import type * as vscode from "vscode";
import type { DiffContentProvider } from "../services/diff-content-provider.js";
import type { GitService } from "../services/git-service.js";
import type {
  createAgentServiceLayer,
  createAuthServiceLayer,
  createConfigServiceLayer,
  createSystemServiceLayer,
  LayerContext,
} from "../services/layer-factory.js";
import type { McpBridgeRuntime } from "../mcp-bridge/runtime.js";

/**
 * Layer types inferred from the layer factory functions for type safety
 */
export type ConfigLayerType = ReturnType<typeof createConfigServiceLayer>;
export type AgentLayerType = ReturnType<typeof createAgentServiceLayer>;
export type AuthLayerType = ReturnType<typeof createAuthServiceLayer>;
export type SystemLayerType = ReturnType<typeof createSystemServiceLayer>;

/**
 * GitServiceContext - inferred from GitService using Effect's Context.Tag.Service
 * Only includes the methods needed for RPC context
 */
type GitServiceInstance = Context.Tag.Service<typeof GitService>;

export type GitServiceContext = Pick<
  GitServiceInstance,
  "getBranchChanges" | "getUncommittedChanges" | "getCurrentCommitHash"
>;

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

  // MCP Bridge runtime for managing custom tools
  mcpBridgeRuntime?: McpBridgeRuntime;
}
