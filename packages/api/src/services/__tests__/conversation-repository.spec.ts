import "../../__mocks__/drizzle.mock.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";
import {
  ConversationRepository,
  ConversationRepositoryDefault,
  type Conversation,
} from "../conversation-repository.js";
import drizzleMock from "../../__mocks__/drizzle.mock.js";

describe("ConversationRepository", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create conversation with generated ID", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";

      // Mock insert chain
      const mockInsert = {
        values: vi.fn().mockResolvedValue(undefined),
      };
      drizzleMock.insert.mockReturnValue(mockInsert as never);

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.create(userId, sourceFile);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
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
      expect(drizzleMock.insert).toHaveBeenCalled();
      expect(mockInsert.values).toHaveBeenCalledWith({
        id: result.id,
        userId,
        sourceFile,
        status: "planning",
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      });
    });

    it("should handle database errors", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";
      const dbError = new Error("Database connection failed");

      const mockInsert = {
        values: vi.fn().mockRejectedValue(dbError),
      };
      drizzleMock.insert.mockReturnValue(mockInsert as never);

      await expect(
        Effect.gen(function* () {
          const repo = yield* ConversationRepository;
          return yield* repo.create(userId, sourceFile);
        }).pipe(
          Effect.provide(ConversationRepositoryDefault),
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
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      drizzleMock.query.conversation.findFirst.mockResolvedValue(
        mockConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(conversationId);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversation);
      expect(drizzleMock.query.conversation.findFirst).toHaveBeenCalled();
    });

    it("should fail with ConversationNotFoundError when not found", async () => {
      const conversationId = "conv-123";

      drizzleMock.query.conversation.findFirst.mockResolvedValue(null as never);

      const exit = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(conversationId);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Effect.exit,
        Runtime.runPromise(runtime),
      );

      expect(exit._tag).toBe("Failure");
      // Check the error string contains the tag name
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
        status: "planning",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      drizzleMock.query.conversation.findFirst.mockResolvedValue(
        mockConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndFile(userId, sourceFile);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversation);
      expect(drizzleMock.query.conversation.findFirst).toHaveBeenCalled();
    });

    it("should return null when no match", async () => {
      const userId = "user-123";
      const sourceFile = "src/components/Button.tsx";

      drizzleMock.query.conversation.findFirst.mockResolvedValue(null as never);

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndFile(userId, sourceFile);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toBeNull();
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
        status: newStatus,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Mock update chain
      const mockUpdate = {
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(undefined),
      };
      drizzleMock.update.mockReturnValue(mockUpdate as never);

      // Mock findById after update
      drizzleMock.query.conversation.findFirst.mockResolvedValue(
        updatedConversation as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.updateStatus(conversationId, newStatus);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result.status).toBe(newStatus);
      expect(drizzleMock.update).toHaveBeenCalled();
      expect(mockUpdate.set).toHaveBeenCalledWith({
        status: newStatus,
        updatedAt: expect.any(Date),
      });
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
          status: "planning",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "conv-2",
          userId,
          sourceFile: "src/components/Input.tsx",
          status: "confirmed",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      drizzleMock.query.conversation.findMany.mockResolvedValue(
        mockConversations as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.list(userId);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockConversations);
      expect(result).toHaveLength(2);
      expect(drizzleMock.query.conversation.findMany).toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("should delete conversation", async () => {
      const conversationId = "conv-123";

      // Mock delete chain
      const mockDelete = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      drizzleMock.delete.mockReturnValue(mockDelete as never);

      await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.delete(conversationId);
      }).pipe(
        Effect.provide(ConversationRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(drizzleMock.delete).toHaveBeenCalled();
      expect(mockDelete.where).toHaveBeenCalled();
    });
  });
});
