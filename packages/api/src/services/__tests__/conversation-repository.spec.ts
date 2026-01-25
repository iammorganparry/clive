import { Effect, Runtime } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createConversationRepositoryTestLayer,
  createMockDrizzleClient,
  mockDeleteChain,
  mockInsertChain,
  mockReset,
  mockUpdateChain,
} from "../../__tests__/test-layer-factory.js";
import {
  type Conversation,
  ConversationRepository,
} from "../conversation-repository.js";

describe("ConversationRepository", () => {
  const runtime = Runtime.defaultRuntime;
  const mockDb = createMockDrizzleClient();

  beforeEach(() => {
    mockReset(mockDb);
  });

  describe("create", () => {
    it("should create conversation with generated ID", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";

      // Set up mock
      mockInsertChain(mockDb);

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.create(userId, sourceFile);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toMatchObject({
        userId,
        sourceFile,
        status: "planning",
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should handle database errors", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";
      const dbError = new Error("Database connection failed");

      const mockInsert = {
        values: () => Promise.reject(dbError),
      };
      mockDb.insert.mockReturnValue(mockInsert as never);

      await expect(
        Effect.gen(function* () {
          const repo = yield* ConversationRepository;
          return yield* repo.create(userId, sourceFile);
        }).pipe(
          Effect.provide(createConversationRepositoryTestLayer(mockDb)),
          Runtime.runPromise(runtime),
        ),
      ).rejects.toThrow();
    });
  });

  describe("findById", () => {
    it("should return conversation when found", async () => {
      const conversationId = "conv-123";
      const mockConversation: Conversation = {
        id: conversationId,
        userId: "user-123",
        sourceFile: "src/components/Button.tsx",
        branchName: null,
        baseBranch: null,
        sourceFiles: null,
        conversationType: "file",
        commitHash: null,
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.conversation.findFirst.mockResolvedValue(
        mockConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(conversationId);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversation);
      expect(mockDb.query.conversation.findFirst).toHaveBeenCalled();
    });

    it("should fail with ConversationNotFoundError when not found", async () => {
      const conversationId = "conv-123";

      mockDb.query.conversation.findFirst.mockResolvedValue(null as never);

      const exit = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(conversationId);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Effect.exit,
        Runtime.runPromise(runtime),
      );

      expect(exit._tag).toBe("Failure");
      expect(String(exit)).toContain("ConversationNotFoundError");
    });
  });

  describe("findByUserAndFile", () => {
    it("should return conversation when found", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";
      const mockConversation: Conversation = {
        id: "conv-123",
        userId,
        sourceFile,
        branchName: null,
        baseBranch: null,
        sourceFiles: null,
        conversationType: "file",
        commitHash: null,
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.conversation.findFirst.mockResolvedValue(
        mockConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndFile(userId, sourceFile);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversation);
      expect(mockDb.query.conversation.findFirst).toHaveBeenCalled();
    });

    it("should return null when no match", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";

      mockDb.query.conversation.findFirst.mockResolvedValue(null as never);

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndFile(userId, sourceFile);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toBeNull();
    });
  });

  describe("findByUserAndBranch", () => {
    it("should find uncommitted conversation when commitHash matches", async () => {
      const userId = "user-123";
      const branchName = "feature/new-feature";
      const baseBranch = "main";
      const conversationType = "uncommitted" as const;
      const commitHash = "abc123def456";

      const mockConversation: Conversation = {
        id: "conv-123",
        userId,
        sourceFile: null,
        branchName,
        baseBranch,
        sourceFiles: JSON.stringify(["src/file1.ts", "src/file2.ts"]),
        conversationType,
        commitHash,
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockDb.query.conversation.findFirst.mockResolvedValue(
        mockConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndBranch(
          userId,
          branchName,
          baseBranch,
          conversationType,
          commitHash,
        );
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversation);
      expect(mockDb.query.conversation.findFirst).toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("should update and return conversation", async () => {
      const conversationId = "conv-123";
      const newStatus = "confirmed" as const;
      const updatedConversation: Conversation = {
        id: conversationId,
        userId: "user-123",
        sourceFile: "src/components/Button.tsx",
        branchName: null,
        baseBranch: null,
        sourceFiles: null,
        conversationType: "file",
        commitHash: null,
        status: newStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock update chain
      mockUpdateChain(mockDb);

      // Mock findById after update
      mockDb.query.conversation.findFirst.mockResolvedValue(
        updatedConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.updateStatus(conversationId, newStatus);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result.status).toBe(newStatus);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe("list", () => {
    it("should return all conversations for user", async () => {
      const userId = "user-123";
      const mockConversations: Conversation[] = [
        {
          id: "conv-1",
          userId,
          sourceFile: "src/components/Button.tsx",
          branchName: null,
          baseBranch: null,
          sourceFiles: null,
          conversationType: "file",
          commitHash: null,
          status: "planning",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "conv-2",
          userId,
          sourceFile: "src/components/Input.tsx",
          branchName: null,
          baseBranch: null,
          sourceFiles: null,
          conversationType: "file",
          commitHash: null,
          status: "confirmed",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      mockDb.query.conversation.findMany.mockResolvedValue(
        mockConversations as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.list(userId);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversations);
      expect(result).toHaveLength(2);
      expect(mockDb.query.conversation.findMany).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete conversation", async () => {
      const conversationId = "conv-123";

      // Mock delete chain
      mockDeleteChain(mockDb);

      await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.delete(conversationId);
      }).pipe(
        Effect.provide(createConversationRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
