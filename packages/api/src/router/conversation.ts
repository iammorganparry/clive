import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";
import { Effect, Runtime } from "effect";
import { z } from "zod/v4";
import {
  ConversationRepository,
  MessageRepository,
} from "../services/index.js";
import { protectedProcedure } from "../trpc.js";

const runtime = Runtime.defaultRuntime;

export const conversationRouter = {
  /**
   * Create a new conversation for a source file
   *
   * @contract conversation.create
   * @see contracts/system.md#conversation.create
   */
  create: protectedProcedure
    .input(z.object({ sourceFile: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.create(ctx.userId, input.sourceFile);
      }).pipe(
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get conversation by ID
   *
   * @contract conversation.getById
   * @see contracts/system.md#conversation.getById
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const conv = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(input.id);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      // Verify ownership
      if (conv.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      return conv;
    }),

  /**
   * Get conversation by user and source file
   *
   * @contract conversation.getByFile
   * @see contracts/system.md#conversation.getByFile
   */
  getByFile: protectedProcedure
    .input(z.object({ sourceFile: z.string() }))
    .query(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndFile(ctx.userId, input.sourceFile);
      }).pipe(
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get conversation by user, branch name, and base branch
   *
   * @contract conversation.getByBranch
   * @see contracts/system.md#conversation.getByBranch
   */
  getByBranch: protectedProcedure
    .input(
      z.object({
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        conversationType: z.enum(["branch", "uncommitted"]),
        commitHash: z.string().optional(), // For uncommitted conversations
      }),
    )
    .query(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findByUserAndBranch(
          ctx.userId,
          input.branchName,
          input.baseBranch,
          input.conversationType,
          input.commitHash,
        );
      }).pipe(
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Create a new conversation for a branch
   *
   * @contract conversation.createForBranch
   * @see contracts/system.md#conversation.createForBranch
   */
  createForBranch: protectedProcedure
    .input(
      z.object({
        branchName: z.string(),
        baseBranch: z.string().default("main"),
        sourceFiles: z.array(z.string()),
        conversationType: z.enum(["branch", "uncommitted"]),
        commitHash: z.string().optional(), // For uncommitted conversations
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.createForBranch(
          ctx.userId,
          input.branchName,
          input.baseBranch,
          input.sourceFiles,
          input.conversationType,
          input.commitHash,
        );
      }).pipe(
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * List all conversations for the user
   *
   * @contract conversation.list
   * @see contracts/system.md#conversation.list
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return Effect.gen(function* () {
      const repo = yield* ConversationRepository;
      return yield* repo.list(ctx.userId);
    }).pipe(
      Effect.catchTag("ConversationError", (error) =>
        Effect.fail(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error.message,
            cause: error.cause,
          }),
        ),
      ),
      Effect.provide(ConversationRepository.Default),
      Runtime.runPromise(runtime),
    );
  }),

  /**
   * Update conversation status
   *
   * @contract conversation.updateStatus
   * @see contracts/system.md#conversation.updateStatus
   */
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(["planning", "confirmed", "completed"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership first
      const conv = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(input.id);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      if (conv.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      return Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.updateStatus(input.id, input.status);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Delete a conversation
   *
   * @contract conversation.delete
   * @see contracts/system.md#conversation.delete
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership first
      const conv = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(input.id);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      if (conv.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        yield* repo.delete(input.id);
      }).pipe(
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      return { success: true };
    }),

  /**
   * Add a message to a conversation
   *
   * @contract conversation.addMessage
   * @see contracts/system.md#conversation.addMessage
   */
  addMessage: protectedProcedure
    .input(
      z.object({
        conversationId: z.string(),
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
        toolCalls: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify conversation ownership
      const conv = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(input.conversationId);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      if (conv.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      return Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.create(
          input.conversationId,
          input.role,
          input.content,
          input.toolCalls,
        );
      }).pipe(
        Effect.catchTag("MessageError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(MessageRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),

  /**
   * Get all messages for a conversation
   *
   * @contract conversation.getMessages
   * @see contracts/system.md#conversation.getMessages
   */
  getMessages: protectedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify conversation ownership
      const conv = await Effect.gen(function* () {
        const repo = yield* ConversationRepository;
        return yield* repo.findById(input.conversationId);
      }).pipe(
        Effect.catchTag("ConversationNotFoundError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "NOT_FOUND",
              message: `Conversation not found: ${error.conversationId}`,
            }),
          ),
        ),
        Effect.catchTag("ConversationError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(ConversationRepository.Default),
        Runtime.runPromise(runtime),
      );

      if (conv.userId !== ctx.userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this conversation",
        });
      }

      return Effect.gen(function* () {
        const repo = yield* MessageRepository;
        return yield* repo.findByConversation(input.conversationId);
      }).pipe(
        Effect.catchTag("MessageError", (error) =>
          Effect.fail(
            new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: error.message,
              cause: error.cause,
            }),
          ),
        ),
        Effect.provide(MessageRepository.Default),
        Runtime.runPromise(runtime),
      );
    }),
} satisfies TRPCRouterRecord;
