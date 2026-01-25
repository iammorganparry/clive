import { Effect } from "effect";
import {
  type ApiError,
  type AuthTokenMissingError,
  type NetworkError,
  wrapTrpcCall,
} from "../utils/trpc-utils.js";
import { ConfigService } from "./config-service.js";
import { TrpcClientService } from "./trpc-client-service.js";

export interface Conversation {
  id: string;
  userId: string;
  sourceFile: string | null;
  branchName: string | null;
  baseBranch: string | null;
  sourceFiles: string | null; // JSON array of file paths
  conversationType: "branch" | "uncommitted" | "file";
  commitHash: string | null; // HEAD commit hash for uncommitted conversations
  status: "planning" | "confirmed" | "completed";
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  toolCalls: string | null;
  createdAt: Date;
}

/**
 * Service for managing conversations with the backend API
 * Handles creating, fetching, and updating conversations and messages
 */
export class ConversationService extends Effect.Service<ConversationService>()(
  "ConversationService",
  {
    effect: Effect.gen(function* () {
      const _configService = yield* ConfigService;
      const trpcClientService = yield* TrpcClientService;

      return {
        /**
         * Create a new conversation for a source file
         */
        createConversation: (sourceFile: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.create.mutate({ sourceFile }),
            )(client);
          }),

        /**
         * Create or get existing conversation for a source file
         */
        getOrCreateConversation: (sourceFile: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();

            // First try to get existing
            const existing = yield* wrapTrpcCall((c) =>
              c.conversation.getByFile.query({ sourceFile }),
            )(client).pipe(
              Effect.catchTag("ApiError", (error) => {
                if (error.status === 404) {
                  return Effect.succeed(null);
                }
                return Effect.fail(error);
              }),
            );

            if (existing) {
              return existing;
            }

            // Create new if not found
            return yield* wrapTrpcCall((c) =>
              c.conversation.create.mutate({ sourceFile }),
            )(client);
          }),

        /**
         * Get existing conversation for a source file (returns null if not found)
         */
        getConversationByFile: (sourceFile: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getByFile.query({ sourceFile }),
            )(client);
          }),

        /**
         * Get conversation by ID
         */
        getConversation: (id: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getById.query({ id }),
            )(client);
          }),

        /**
         * Get all messages for a conversation
         */
        getMessages: (conversationId: string) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getMessages.query({ conversationId }),
            )(client);
          }),

        /**
         * Add a message to a conversation
         */
        addMessage: (
          conversationId: string,
          role: "user" | "assistant" | "system",
          content: string,
          toolCalls?: unknown,
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.addMessage.mutate({
                conversationId,
                role,
                content,
                toolCalls,
              }),
            )(client);
          }),

        /**
         * Update conversation status
         */
        updateStatus: (
          conversationId: string,
          status: "planning" | "confirmed" | "completed",
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.updateStatus.mutate({
                id: conversationId,
                status,
              }),
            )(client);
          }),

        /**
         * List all conversations for the user
         */
        listConversations: () =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) => c.conversation.list.query())(
              client,
            );
          }),

        /**
         * Get or create conversation for a branch
         */
        getOrCreateBranchConversation: (
          branchName: string,
          baseBranch: string,
          sourceFiles: string[],
          conversationType: "branch" | "uncommitted",
          commitHash?: string, // For uncommitted
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();

            // First try to get existing
            const existing = yield* wrapTrpcCall((c) =>
              c.conversation.getByBranch.query({
                branchName,
                baseBranch,
                conversationType,
                commitHash,
              }),
            )(client).pipe(
              Effect.catchTag("ApiError", (error) => {
                if (error.status === 404) {
                  return Effect.succeed(null);
                }
                return Effect.fail(error);
              }),
            );

            if (existing) {
              return existing;
            }

            // Create new if not found
            return yield* wrapTrpcCall((c) =>
              c.conversation.createForBranch.mutate({
                branchName,
                baseBranch,
                sourceFiles,
                conversationType,
                commitHash,
              }),
            )(client);
          }),

        /**
         * Get existing conversation for a branch (returns null if not found)
         */
        getConversationByBranch: (
          branchName: string,
          baseBranch: string,
          conversationType: "branch" | "uncommitted",
          commitHash?: string,
        ) =>
          Effect.gen(function* () {
            const client = yield* trpcClientService.getClient();
            return yield* wrapTrpcCall((c) =>
              c.conversation.getByBranch.query({
                branchName,
                baseBranch,
                conversationType,
                commitHash,
              }),
            )(client);
          }),
      };
    }),
    // No dependencies - allows test injection via Layer.provide()
  },
) {}

/**
 * Production layer with all dependencies composed.
 * Use this in production code; use ConversationService.Default in tests with mocked deps.
 */
/**
 * ConversationService depends on ConfigService which has context-specific deps.
 * Use ConversationService.Default directly - dependencies provided at composition site.
 */
export const ConversationServiceLive = ConversationService.Default;

export type { ApiError, NetworkError, AuthTokenMissingError };
