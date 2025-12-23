import { Effect, Layer } from "effect";
import { ConfigService } from "../services/config-service.js";
import type { RepositoryService } from "../services/repository-service.js";
import { SecretStorageService } from "../services/vs-code.js";
import { getWorkspaceRoot } from "./vscode-effects.js";

/**
 * Common layer combination for knowledge base operations
 * Combines ConfigService and SecretStorageService layers
 */
export const KnowledgeBaseConfigLayer = Layer.merge(
  ConfigService.Default,
  SecretStorageService.Default,
);

/**
 * Get repository ID for the current workspace
 * Shared utility for knowledge base tools to avoid code duplication
 */
export const getRepositoryIdForWorkspace = (
  repositoryService: RepositoryService,
) => {
  return Effect.gen(function* () {
    const configService = yield* ConfigService;
    const userId = yield* configService.getUserId();
    const organizationId = yield* configService.getOrganizationId();
    const workspaceRoot = yield* getWorkspaceRoot();
    const rootPath = workspaceRoot.fsPath;
    const workspaceName = rootPath.split("/").pop() || "workspace";

    const repository = yield* repositoryService.upsertRepository(
      userId,
      workspaceName,
      rootPath,
      organizationId,
    );

    return repository.id;
  }).pipe(Effect.provide(KnowledgeBaseConfigLayer));
};
