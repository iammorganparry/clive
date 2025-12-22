import { describe, it, expect, beforeEach } from "vitest";
import { Effect, Runtime } from "effect";
import { MessageRepository, type Message } from "../message-repository.js";
import {
  createMockDrizzleClient,
  createMessageRepositoryTestLayer,
  mockInsertChain,
  mockReset,
} from "../../__tests__/test-layer-factory.js";

describe("MessageRepository", () => {
  const runtime = Runtime.defaultRuntime;
  const mockDb = createMockDrizzleClient();

  beforeEach(() => {
    mockReset(mockDb);
  });

  describe("create", () => {
    it("should create message with generated ID", async () => {
      const conversationId = "conv-123";
      const role = "user" as const;
      const content = "Hello, world!";

      // Set up mock
      mockInsertChain(mockDb);

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.create(conversationId, role, content);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toMatchObject({
        conversationId,
        role,
        content,
        toolCalls: null,
      });
      expect(result.id).toBeDefined();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should serialize toolCalls to JSON", async () => {
      const conversationId = "conv-123";
      const role = "assistant" as const;
      const content = "Here's a response";
      const toolCalls = [
        { name: "function1", arguments: { arg1: "value1" } },
        { name: "function2", arguments: { arg2: "value2" } },
      ];

      mockInsertChain(mockDb);

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.create(conversationId, role, content, toolCalls);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result.toolCalls).toBe(JSON.stringify(toolCalls));
    });
  });

  describe("findById", () => {
    it("should return message when found", async () => {
      const messageId = "msg-123";
      const mockMessage: Message = {
        id: messageId,
        conversationId: "conv-123",
        role: "user",
        content: "Hello!",
        toolCalls: null,
        createdAt: new Date(),
      };

      mockDb.query.conversationMessage.findFirst.mockResolvedValue(
        mockMessage as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findById(messageId);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockMessage);
      expect(mockDb.query.conversationMessage.findFirst).toHaveBeenCalled();
    });

    it("should fail with MessageNotFoundError when not found", async () => {
      const messageId = "msg-123";

      mockDb.query.conversationMessage.findFirst.mockResolvedValue(
        null as never,
      );

      const exit = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findById(messageId);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Effect.exit,
        Runtime.runPromise(runtime),
      );

      expect(exit._tag).toBe("Failure");
      expect(String(exit)).toContain("MessageNotFoundError");
    });
  });

  describe("findByConversation", () => {
    it("should return all messages for conversation", async () => {
      const conversationId = "conv-123";
      const mockMessages: Message[] = [
        {
          id: "msg-1",
          conversationId,
          role: "user",
          content: "First message",
          toolCalls: null,
          createdAt: new Date("2024-01-01"),
        },
        {
          id: "msg-2",
          conversationId,
          role: "assistant",
          content: "Second message",
          toolCalls: JSON.stringify([{ name: "test" }]),
          createdAt: new Date("2024-01-02"),
        },
      ];

      mockDb.query.conversationMessage.findMany.mockResolvedValue(
        mockMessages as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findByConversation(conversationId);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockMessages);
      expect(result).toHaveLength(2);
      expect(mockDb.query.conversationMessage.findMany).toHaveBeenCalled();
    });

    it("should return empty array when no messages found", async () => {
      const conversationId = "conv-123";

      mockDb.query.conversationMessage.findMany.mockResolvedValue([] as never);

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findByConversation(conversationId);
      }).pipe(
        Effect.provide(createMessageRepositoryTestLayer(mockDb)),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });
});
