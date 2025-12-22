/**
 * Test Layer Factory for API Package
 *
 * Provides reusable mock factories and test layers for Effect-based services.
 * Mirrors the production layer-factory.ts pattern for consistency.
 *
 * Usage:
 * ```typescript
 * const mockDb = createMockDrizzleClient();
 * mockDb.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
 *
 * const result = await Effect.gen(function* () {
 *   const repo = yield* SomeRepository;
 *   return yield* repo.someMethod();
 * }).pipe(
 *   Effect.provide(createRepositoryTestLayer(mockDb)),
 *   Runtime.runPromise(runtime),
 * );
 * ```
 */

import { Layer } from "effect";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import { DrizzleDB, type DrizzleClient } from "../services/drizzle-db.js";
import { ConversationRepository } from "../services/conversation-repository.js";
import { MessageRepository } from "../services/message-repository.js";
import { RepositoryRepository } from "../services/repository-repository.js";

// =============================================================================
// Mock Factories
// =============================================================================

/**
 * Create a fresh mock Drizzle database client
 * Use this to get a new mock instance for each test
 */
export const createMockDrizzleClient = (): DeepMockProxy<DrizzleClient> =>
  mockDeep<DrizzleClient>();

// =============================================================================
// Layer Factories
// =============================================================================

/**
 * Create a DrizzleDB test layer from a mock client
 * This is the foundation layer that repositories depend on
 */
export const createDrizzleDBTestLayer = (
  mockDb: DeepMockProxy<DrizzleClient>,
): Layer.Layer<DrizzleDB> => Layer.succeed(DrizzleDB, mockDb as DrizzleClient);

/**
 * Create a complete ConversationRepository test layer
 * Includes DrizzleDB mock layer
 */
export function createConversationRepositoryTestLayer(
  mockDb: DeepMockProxy<DrizzleClient>,
): Layer.Layer<ConversationRepository> {
  return ConversationRepository.Default.pipe(
    Layer.provide(createDrizzleDBTestLayer(mockDb)),
  );
}

/**
 * Create a complete MessageRepository test layer
 * Includes DrizzleDB mock layer
 */
export function createMessageRepositoryTestLayer(
  mockDb: DeepMockProxy<DrizzleClient>,
): Layer.Layer<MessageRepository> {
  return MessageRepository.Default.pipe(
    Layer.provide(createDrizzleDBTestLayer(mockDb)),
  );
}

/**
 * Create a complete RepositoryRepository test layer
 * Includes DrizzleDB mock layer
 */
export function createRepositoryRepositoryTestLayer(
  mockDb: DeepMockProxy<DrizzleClient>,
): Layer.Layer<RepositoryRepository> {
  return RepositoryRepository.Default.pipe(
    Layer.provide(createDrizzleDBTestLayer(mockDb)),
  );
}

// =============================================================================
// Combined Test Layers
// =============================================================================

/**
 * Create a test layer with all repository services
 * Useful for integration-style tests
 */
export function createAllRepositoriesTestLayer(
  mockDb: DeepMockProxy<DrizzleClient>,
): Layer.Layer<
  ConversationRepository | MessageRepository | RepositoryRepository
> {
  const drizzleLayer = createDrizzleDBTestLayer(mockDb);
  return Layer.mergeAll(
    ConversationRepository.Default,
    MessageRepository.Default,
    RepositoryRepository.Default,
  ).pipe(Layer.provide(drizzleLayer));
}

// =============================================================================
// Mock Helpers
// =============================================================================

/**
 * Helper to set up common mock chain patterns for Drizzle
 */
export const mockInsertChain = (
  mockDb: DeepMockProxy<DrizzleClient>,
  resolvedValue: unknown = undefined,
) => {
  const mockInsert = {
    values: mockDeep<{ values: () => Promise<unknown> }>().values,
  };
  mockInsert.values.mockResolvedValue(resolvedValue);
  mockDb.insert.mockReturnValue(mockInsert as never);
  return mockInsert;
};

export const mockUpdateChain = (
  mockDb: DeepMockProxy<DrizzleClient>,
  resolvedValue: unknown = undefined,
) => {
  const mockUpdate = {
    set: mockDeep<{ set: () => { where: () => Promise<unknown> } }>().set,
    where: mockDeep<{ where: () => Promise<unknown> }>().where,
  };
  mockUpdate.set.mockReturnThis();
  mockUpdate.where.mockResolvedValue(resolvedValue);
  mockDb.update.mockReturnValue(mockUpdate as never);
  return mockUpdate;
};

export const mockDeleteChain = (
  mockDb: DeepMockProxy<DrizzleClient>,
  resolvedValue: unknown = undefined,
) => {
  const mockDelete = {
    where: mockDeep<{ where: () => Promise<unknown> }>().where,
  };
  mockDelete.where.mockResolvedValue(resolvedValue);
  mockDb.delete.mockReturnValue(mockDelete as never);
  return mockDelete;
};

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type { DeepMockProxy } from "vitest-mock-extended";
export { mockDeep, mockReset } from "vitest-mock-extended";
