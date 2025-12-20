import "../../__mocks__/drizzle.mock.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect, Runtime } from "effect";
import {
  MessageRepository,
  MessageRepositoryDefault,
  type Message,
} from "../message-repository.js";
import drizzleMock from "../../__mocks__/drizzle.mock.js";

describe("MessageRepository", () => {
  const runtime = Runtime.defaultRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("create", () => {
    it("should create message with generated ID", async () => {
      const conversationId = "conv-123";
      const role = "user" as const;
      const content = "Hello, world!";

      // Mock insert chain
      const mockInsert = {
        values: vi.fn().mockResolvedValue(undefined),
      };
      drizzleMock.insert.mockReturnValue(mockInsert as never);

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.create(conversationId, role, content);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
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
      expect(drizzleMock.insert).toHaveBeenCalled();
      expect(mockInsert.values).toHaveBeenCalledWith({
        id: result.id,
        conversationId,
        role,
        content,
        toolCalls: null,
        createdAt: expect.any(Date),
      });
    });

    it("should serialize toolCalls to JSON", async () => {
      const conversationId = "conv-123";
      const role = "assistant" as const;
      const content = "Here's a response";
      const toolCalls = [
        { name: "function1", arguments: { arg1: "value1" } },
        { name: "function2", arguments: { arg2: "value2" } },
      ];

      const mockInsert = {
        values: vi.fn().mockResolvedValue(undefined),
      };
      drizzleMock.insert.mockReturnValue(mockInsert as never);

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.create(conversationId, role, content, toolCalls);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result.toolCalls).toBe(JSON.stringify(toolCalls));
      expect(mockInsert.values).toHaveBeenCalledWith({
        id: result.id,
        conversationId,
        role,
        content,
        toolCalls: JSON.stringify(toolCalls),
        createdAt: expect.any(Date),
      });
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

      drizzleMock.query.conversationMessage.findFirst.mockResolvedValue(
        mockMessage as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findById(messageId);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockMessage);
      expect(
        drizzleMock.query.conversationMessage.findFirst,
      ).toHaveBeenCalled();
    });

    it("should fail with MessageNotFoundError when not found", async () => {
      const messageId = "msg-123";

      drizzleMock.query.conversationMessage.findFirst.mockResolvedValue(
        null as never,
      );

      const exit = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findById(messageId);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
        Effect.exit,
        Runtime.runPromise(runtime),
      );

      expect(exit._tag).toBe("Failure");
      // Check the error string contains the tag name
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

      drizzleMock.query.conversationMessage.findMany.mockResolvedValue(
        mockMessages as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findByConversation(conversationId);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual(mockMessages);
      expect(result).toHaveLength(2);
      expect(drizzleMock.query.conversationMessage.findMany).toHaveBeenCalled();
    });

    it("should return empty array when no messages found", async () => {
      const conversationId = "conv-123";

      drizzleMock.query.conversationMessage.findMany.mockResolvedValue(
        [] as never,
      );

      const result = await Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findByConversation(conversationId);
      }).pipe(
        Effect.provide(MessageRepositoryDefault),
        Runtime.runPromise(runtime),
      );

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });
  });
});
