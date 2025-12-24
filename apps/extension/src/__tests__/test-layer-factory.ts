/**
 * Test Layer Factory for Extension
 *
 * Centralized test utilities that mirror the production layer-factory.ts pattern.
 * Provides reusable mock factories and test layers for Effect-based services.
 *
 * Tier Architecture (mirrors production):
 * - Tier 0 (Core): VSCodeService, SecretStorage, Logger
 * - Tier 1 (Base): ConfigService, ApiKeyService
 * - Tier 2 (Domain): RepositoryService, ConversationService, ReactFileFilter
 * - Tier 3 (Features): CodebaseIndexingService, Agents
 *
 * Usage:
 * ```typescript
 * const { layer, mockSecrets, storedTokens } = createBaseTestLayer();
 *
 * const result = await Effect.gen(function* () {
 *   const configService = yield* ConfigService;
 *   return yield* configService.isConfigured();
 * }).pipe(Effect.provide(layer), Runtime.runPromise(runtime));
 * ```
 */

import { Layer, Effect } from "effect";
import { vi, type Mock } from "vitest";
import type * as vscode from "vscode";

import { VSCodeService, SecretStorageService } from "../services/vs-code.js";
import { createLoggerLayer } from "../services/logger-service.js";
import { ConfigService } from "../services/config-service.js";
import { ApiKeyService } from "../services/api-key-service.js";
import { TrpcClientService } from "../services/trpc-client-service.js";
import { RepositoryService } from "../services/repository-service.js";
import { CodebaseIndexingService } from "../services/codebase-indexing-service.js";
import { ConversationService } from "../services/conversation-service.js";
import { ReactFileFilter } from "../services/react-file-filter.js";
import { KnowledgeBaseService } from "../services/knowledge-base-service.js";
import { KnowledgeBaseAgent } from "../services/ai-agent/knowledge-base-agent.js";
import { KnowledgeFileService } from "../services/knowledge-file-service.js";

// =============================================================================
// Types
// =============================================================================

export interface MockSecretStorage {
  get: Mock<(key: string) => Promise<string | undefined>>;
  store: Mock<(key: string, value: string) => Promise<void>>;
  delete: Mock<(key: string) => Promise<void>>;
  onDidChange: Mock;
}

export interface MockOutputChannel {
  appendLine: Mock;
  show: Mock;
  clear: Mock;
  dispose: Mock;
}

export interface TestLayerContext {
  mockSecrets: MockSecretStorage;
  storedTokens: Map<string, string>;
  mockOutputChannel: MockOutputChannel;
}

// =============================================================================
// Tier 0: Core Mock Factories
// =============================================================================

/**
 * Create a mock SecretStorage with in-memory token storage
 */
export function createMockSecretStorage(): {
  mockSecrets: MockSecretStorage;
  storedTokens: Map<string, string>;
} {
  const storedTokens = new Map<string, string>();

  const mockSecrets: MockSecretStorage = {
    get: vi.fn(async (key: string) => storedTokens.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      storedTokens.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      storedTokens.delete(key);
    }),
    onDidChange: vi.fn(),
  };

  return { mockSecrets, storedTokens };
}

/**
 * Create a mock OutputChannel
 */
export function createMockOutputChannel(): MockOutputChannel {
  return {
    appendLine: vi.fn(),
    show: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
  };
}

/**
 * Create a mock VSCode workspace
 */
export function createMockWorkspace(
  overrides: Partial<{
    workspaceFolders: vscode.WorkspaceFolder[];
    findFiles: Mock;
    fs: Partial<typeof vscode.workspace.fs>;
  }> = {},
) {
  const defaultWorkspaceFolders = [
    {
      uri: { fsPath: "/workspace", scheme: "file" },
      name: "workspace",
      index: 0,
    },
  ] as unknown as vscode.WorkspaceFolder[];

  return {
    workspaceFolders: overrides.workspaceFolders ?? defaultWorkspaceFolders,
    findFiles: overrides.findFiles ?? vi.fn().mockResolvedValue([]),
    fs: {
      stat: vi.fn().mockResolvedValue({
        type: 1,
        ctime: Date.now(),
        mtime: Date.now(),
        size: 100,
      }),
      readFile: vi
        .fn()
        .mockResolvedValue(Buffer.from("export const test = 1;")),
      ...overrides.fs,
    },
  } as unknown as typeof vscode.workspace;
}

// =============================================================================
// Tier 0: Core Layer Factories
// =============================================================================

/**
 * Create SecretStorageService test layer
 */
export function createSecretStorageTestLayer(
  mockSecrets: MockSecretStorage,
): Layer.Layer<SecretStorageService> {
  return Layer.succeed(SecretStorageService, {
    _tag: "SecretStorageService",
    secrets: mockSecrets as unknown as vscode.SecretStorage,
  });
}

/**
 * Create VSCodeService test layer
 */
export function createVSCodeServiceTestLayer(
  mockWorkspace?: ReturnType<typeof createMockWorkspace>,
): Layer.Layer<VSCodeService> {
  const workspace = mockWorkspace ?? createMockWorkspace();
  return Layer.succeed(VSCodeService, {
    _tag: "VSCodeService",
    workspace,
  });
}

/**
 * Create Logger test layer
 */
export function createLoggerTestLayer(
  mockOutputChannel?: MockOutputChannel,
  isDev = false,
): Layer.Layer<never, never, never> {
  const outputChannel = mockOutputChannel ?? createMockOutputChannel();
  return createLoggerLayer(
    outputChannel as unknown as vscode.OutputChannel,
    isDev,
  );
}

// =============================================================================
// Tier 2: Domain Mock Factories
// =============================================================================

export interface RepositoryServiceOverrides {
  getUserId?: Mock;
  getOrganizationId?: Mock;
  upsertRepository?: Mock;
  upsertFile?: Mock;
  getRepository?: Mock;
  deleteFile?: Mock;
  getFileByPath?: Mock;
  getFileHashes?: Mock;
  getIndexingStatus?: Mock;
  searchFiles?: Mock;
}

/**
 * Create a mock RepositoryService layer
 */
export function createMockRepositoryServiceLayer(
  overrides: RepositoryServiceOverrides = {},
): Layer.Layer<RepositoryService> {
  const defaults = {
    getUserId: vi.fn().mockReturnValue(Effect.succeed("test-user-123")),
    getOrganizationId: vi.fn().mockReturnValue(Effect.succeed(null)),
    upsertRepository: vi.fn().mockReturnValue(Effect.succeed({})),
    upsertFile: vi.fn().mockReturnValue(Effect.void),
    getRepository: vi.fn().mockReturnValue(Effect.succeed(null)),
    deleteFile: vi.fn().mockReturnValue(Effect.void),
    getFileByPath: vi.fn().mockReturnValue(Effect.succeed(null)),
    getFileHashes: vi.fn().mockReturnValue(Effect.succeed(new Map())),
    getIndexingStatus: vi.fn().mockReturnValue(
      Effect.succeed({
        status: "idle" as const,
        repositoryName: null,
        repositoryPath: null,
        lastIndexedAt: null,
        fileCount: 0,
      }),
    ),
    searchFiles: vi.fn().mockReturnValue(Effect.succeed([])),
  };

  return Layer.succeed(RepositoryService, {
    _tag: "RepositoryService",
    ...defaults,
    ...overrides,
  } as unknown as RepositoryService);
}

export interface IndexingServiceOverrides {
  indexFile?: Mock;
  indexWorkspace?: Mock;
  semanticSearch?: Mock;
  getStatus?: Mock;
}

/**
 * Create a mock CodebaseIndexingService layer
 */
export function createMockIndexingServiceLayer(
  overrides: IndexingServiceOverrides = {},
): Layer.Layer<CodebaseIndexingService> {
  const defaults = {
    indexFile: vi.fn().mockReturnValue(Effect.succeed({})),
    indexWorkspace: vi.fn().mockReturnValue(Effect.void),
    semanticSearch: vi.fn().mockReturnValue(Effect.succeed([])),
    getStatus: vi.fn().mockReturnValue(Effect.succeed("idle" as const)),
  };

  return Layer.succeed(CodebaseIndexingService, {
    _tag: "CodebaseIndexingService",
    ...defaults,
    ...overrides,
  } as unknown as CodebaseIndexingService);
}

export interface ConversationServiceOverrides {
  sendMessage?: Mock;
  listConversations?: Mock;
}

/**
 * Create a mock ConversationService layer
 */
export function createMockConversationServiceLayer(
  overrides: ConversationServiceOverrides = {},
): Layer.Layer<ConversationService> {
  const defaults = {
    sendMessage: vi.fn().mockReturnValue(Effect.succeed({ response: "" })),
    listConversations: vi.fn().mockReturnValue(Effect.succeed([])),
  };

  return Layer.succeed(ConversationService, {
    _tag: "ConversationService",
    ...defaults,
    ...overrides,
  } as unknown as ConversationService);
}

export interface ReactFileFilterOverrides {
  checkFileEligibility?: Mock;
  filterEligibleFiles?: Mock;
}

/**
 * Create a mock ReactFileFilter layer
 */
export function createMockReactFileFilterLayer(
  overrides: ReactFileFilterOverrides = {},
): Layer.Layer<ReactFileFilter> {
  const defaults = {
    checkFileEligibility: vi
      .fn()
      .mockReturnValue(Effect.succeed({ isEligible: true })),
    filterEligibleFiles: vi.fn().mockReturnValue(Effect.succeed([])),
  };

  return Layer.succeed(ReactFileFilter, {
    _tag: "ReactFileFilter",
    ...defaults,
    ...overrides,
  } as unknown as ReactFileFilter);
}

export interface KnowledgeBaseAgentOverrides {
  analyze?: Mock;
}

/**
 * Create a mock KnowledgeBaseAgent layer
 */
export function createMockKnowledgeBaseAgentLayer(
  overrides: KnowledgeBaseAgentOverrides = {},
): Layer.Layer<KnowledgeBaseAgent> {
  const defaults = {
    analyze: vi.fn().mockReturnValue(
      Effect.succeed({
        success: true,
        entryCount: 0,
      }),
    ),
  };

  return Layer.succeed(KnowledgeBaseAgent, {
    _tag: "KnowledgeBaseAgent",
    ...defaults,
    ...overrides,
  } as unknown as KnowledgeBaseAgent);
}

export interface KnowledgeBaseServiceOverrides {
  analyzeRepository?: Mock;
  getStatus?: Mock;
}

/**
 * Create a mock KnowledgeBaseService layer
 */
export function createMockKnowledgeBaseServiceLayer(
  overrides: KnowledgeBaseServiceOverrides = {},
): Layer.Layer<KnowledgeBaseService> {
  const defaults = {
    analyzeRepository: vi.fn().mockReturnValue(
      Effect.succeed({
        success: true,
        entryCount: 0,
      }),
    ),
    getStatus: vi.fn().mockReturnValue(
      Effect.succeed({
        hasKnowledge: false,
        lastUpdatedAt: null,
        categories: [],
        entryCount: 0,
      }),
    ),
  };

  return Layer.succeed(KnowledgeBaseService, {
    _tag: "KnowledgeBaseService",
    ...defaults,
    ...overrides,
  } as unknown as KnowledgeBaseService);
}

export interface KnowledgeFileServiceOverrides {
  writeKnowledgeFile?: Mock;
  readKnowledgeFile?: Mock;
  grepKnowledgeFiles?: Mock;
  listKnowledgeFiles?: Mock;
  knowledgeBaseExists?: Mock;
}

/**
 * Create a mock KnowledgeFileService layer
 */
export function createMockKnowledgeFileServiceLayer(
  overrides: KnowledgeFileServiceOverrides = {},
): Layer.Layer<KnowledgeFileService> {
  const defaults = {
    writeKnowledgeFile: vi.fn().mockReturnValue(
      Effect.succeed({
        path: ".clive/knowledge/test.md",
        relativePath: ".clive/knowledge/test.md",
      }),
    ),
    readKnowledgeFile: vi.fn().mockReturnValue(
      Effect.succeed({
        path: ".clive/knowledge/test.md",
        relativePath: ".clive/knowledge/test.md",
        metadata: {
          category: "patterns",
          title: "Test Pattern",
          updatedAt: new Date().toISOString(),
        },
        content: "Test content",
      }),
    ),
    grepKnowledgeFiles: vi.fn().mockReturnValue(Effect.succeed([])),
    listKnowledgeFiles: vi.fn().mockReturnValue(Effect.succeed([])),
    knowledgeBaseExists: vi.fn().mockReturnValue(Effect.succeed(false)),
  };

  return Layer.succeed(KnowledgeFileService, {
    _tag: "KnowledgeFileService",
    ...defaults,
    ...overrides,
  } as unknown as KnowledgeFileService);
}

// =============================================================================
// Composed Test Layers (mirror production layer-factory.ts)
// =============================================================================

/**
 * Create Tier 0 Core test layer
 * Includes: SecretStorageService, VSCodeService, Logger
 */
export function createCoreTestLayer(options?: {
  mockSecrets?: MockSecretStorage;
  storedTokens?: Map<string, string>;
  mockOutputChannel?: MockOutputChannel;
  mockWorkspace?: ReturnType<typeof createMockWorkspace>;
  isDev?: boolean;
}) {
  const { mockSecrets, storedTokens } = options?.mockSecrets
    ? {
        mockSecrets: options.mockSecrets,
        storedTokens: options.storedTokens ?? new Map(),
      }
    : createMockSecretStorage();

  const mockOutputChannel =
    options?.mockOutputChannel ?? createMockOutputChannel();

  const layer = Layer.mergeAll(
    createSecretStorageTestLayer(mockSecrets),
    createVSCodeServiceTestLayer(options?.mockWorkspace),
    createLoggerTestLayer(mockOutputChannel, options?.isDev ?? false),
  );

  return { layer, mockSecrets, storedTokens, mockOutputChannel };
}

/**
 * Create Tier 1 Base test layer
 * Includes: Core + ConfigService, ApiKeyService
 *
 * Note: We need to provide the core layer to the service defaults
 * because they have dependencies that need to be satisfied.
 */
export function createBaseTestLayer(
  options?: Parameters<typeof createCoreTestLayer>[0],
) {
  const core = createCoreTestLayer(options);

  // ApiKeyService depends on SecretStorageService
  const apiKeyLayer = ApiKeyService.Default.pipe(
    Layer.provide(createSecretStorageTestLayer(core.mockSecrets)),
  );

  // ConfigService depends on SecretStorageService and ApiKeyService
  const configLayer = ConfigService.Default.pipe(
    Layer.provide(apiKeyLayer),
    Layer.provide(createSecretStorageTestLayer(core.mockSecrets)),
  );

  // TrpcClientService depends on ConfigService
  const trpcClientLayer = TrpcClientService.Default.pipe(
    Layer.provide(configLayer),
  );

  // Merge all layers together
  const layer = Layer.mergeAll(
    core.layer,
    apiKeyLayer,
    configLayer,
    trpcClientLayer,
  );

  return { ...core, layer };
}

/**
 * Create Config test layer (for config router tests)
 * Includes: Base + Domain services + Indexing + Knowledge Base services
 * This matches the type signature of createConfigServiceLayer from layer-factory.ts
 */
/**
 * Create a test domain layer that mirrors production createDomainLayer
 * but uses mock services instead of real ones
 */
function createDomainTestLayer(
  baseLayer: ReturnType<typeof createBaseTestLayer>,
  options?: {
    repositoryOverrides?: RepositoryServiceOverrides;
    conversationOverrides?: ConversationServiceOverrides;
    reactFileFilterOverrides?: ReactFileFilterOverrides;
  },
) {
  // RepositoryService depends on ConfigService (in baseLayer)
  const repoLayer = createMockRepositoryServiceLayer(
    options?.repositoryOverrides,
  ).pipe(Layer.provide(baseLayer.layer));

  // ConversationService depends on ConfigService (in baseLayer)
  const convLayer = createMockConversationServiceLayer(
    options?.conversationOverrides,
  ).pipe(Layer.provide(baseLayer.layer));

  // ReactFileFilter depends on VSCodeService (in baseLayer via coreLayer)
  const reactFilterLayer = createMockReactFileFilterLayer(
    options?.reactFileFilterOverrides,
  ).pipe(Layer.provide(baseLayer.layer));

  return Layer.mergeAll(
    baseLayer.layer,
    repoLayer,
    convLayer,
    reactFilterLayer,
  );
}

export function createConfigTestLayer(
  options?: Parameters<typeof createCoreTestLayer>[0] & {
    repositoryOverrides?: RepositoryServiceOverrides;
    indexingOverrides?: IndexingServiceOverrides;
    conversationOverrides?: ConversationServiceOverrides;
    reactFileFilterOverrides?: ReactFileFilterOverrides;
    knowledgeBaseAgentOverrides?: KnowledgeBaseAgentOverrides;
    knowledgeBaseServiceOverrides?: KnowledgeBaseServiceOverrides;
    knowledgeFileServiceOverrides?: KnowledgeFileServiceOverrides;
  },
) {
  const base = createBaseTestLayer(options);

  // Domain layer (mirrors production createDomainLayer)
  const domainLayer = createDomainTestLayer(base, {
    repositoryOverrides: options?.repositoryOverrides,
    conversationOverrides: options?.conversationOverrides,
    reactFileFilterOverrides: options?.reactFileFilterOverrides,
  });

  // Add indexing layer
  const indexingLayer = CodebaseIndexingService.Default.pipe(
    Layer.provide(domainLayer),
  );

  // KnowledgeFileService depends on VSCodeService (in baseLayer via coreLayer)
  const knowledgeFileLayer = createMockKnowledgeFileServiceLayer(
    options?.knowledgeFileServiceOverrides,
  ).pipe(Layer.provide(base.layer));

  // KnowledgeBaseAgent depends on ConfigService, RepositoryService, and KnowledgeFileService
  const knowledgeBaseAgentLayer = createMockKnowledgeBaseAgentLayer(
    options?.knowledgeBaseAgentOverrides,
  ).pipe(Layer.provide(Layer.mergeAll(domainLayer, knowledgeFileLayer)));

  // KnowledgeBaseService depends on KnowledgeBaseAgent and KnowledgeFileService
  const knowledgeBaseServiceLayer = createMockKnowledgeBaseServiceLayer(
    options?.knowledgeBaseServiceOverrides,
  ).pipe(
    Layer.provide(
      Layer.mergeAll(domainLayer, knowledgeBaseAgentLayer, knowledgeFileLayer),
    ),
  );

  const layer = Layer.mergeAll(
    domainLayer,
    indexingLayer,
    knowledgeFileLayer,
    knowledgeBaseAgentLayer,
    knowledgeBaseServiceLayer,
  );

  return { ...base, layer };
}

/**
 * Create a layer for testing the REAL CodebaseIndexingService implementation
 * (not a mock). Use this when testing the service's actual behavior.
 *
 * Includes: Base + RepositoryService (mocked)
 * Does NOT include IndexingService mock - uses real implementation
 */
export function createRealIndexingTestLayer(
  options?: Parameters<typeof createCoreTestLayer>[0] & {
    repositoryOverrides?: RepositoryServiceOverrides;
  },
) {
  const base = createBaseTestLayer(options);

  const layer = Layer.mergeAll(
    base.layer,
    createMockRepositoryServiceLayer(options?.repositoryOverrides),
  );

  // Provide all dependencies to the REAL CodebaseIndexingService.Default
  const indexingLayer = CodebaseIndexingService.Default.pipe(
    Layer.provide(layer),
  );

  // Merge the indexing layer with dependencies so all services are available
  const fullLayer = Layer.mergeAll(layer, indexingLayer);

  return { ...base, layer: fullLayer };
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Default test user info
 */
export const defaultTestUserInfo = {
  userId: "test-user-123",
  email: "test@example.com",
  name: "Test User",
  organizationId: "test-org-123",
};

/**
 * Pre-populate auth token and user info in test storage
 * Since we no longer decode JWTs, we also need to set user info
 */
export function setAuthToken(
  storedTokens: Map<string, string>,
  token = "test-session-token",
  userInfo = defaultTestUserInfo,
) {
  storedTokens.set("clive.auth_token", token);
  storedTokens.set("clive.user_info", JSON.stringify(userInfo));
}

/**
 * Pre-populate only user info in test storage (without token)
 */
export function setUserInfo(
  storedTokens: Map<string, string>,
  userInfo = defaultTestUserInfo,
) {
  storedTokens.set("clive.user_info", JSON.stringify(userInfo));
}

/**
 * Pre-populate Anthropic API key in test storage
 */
export function setAnthropicApiKey(
  storedTokens: Map<string, string>,
  key = "sk-ant-api03-test-key",
) {
  storedTokens.set("clive.anthropic_api_key", key);
}

/**
 * Clear all stored tokens
 */
export function clearStoredTokens(storedTokens: Map<string, string>) {
  storedTokens.clear();
}
