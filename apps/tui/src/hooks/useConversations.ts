/**
 * useConversations Hook
 * React Query hook for fetching Claude CLI conversations
 * Uses Effect-based ConversationService
 */

import { useQuery } from '@tanstack/react-query';
import { Effect, Layer } from 'effect';
import { ConversationService, type Conversation } from '../services/ConversationService';
import { SessionMetadataService } from '../services/SessionMetadataService';

/**
 * Fetch recent conversations for a specific project
 */
export function useConversations(projectPath: string, limit: number = 20) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', projectPath, limit],
    queryFn: async () => {
      const program = Effect.gen(function* () {
        const service = yield* ConversationService;
        return yield* service.getConversationsForProject(projectPath, limit);
      });

      // Run the Effect program with both service layers
      const serviceLayers = Layer.merge(
        ConversationService.Default,
        SessionMetadataService.Default
      );

      return await Effect.runPromise(
        program.pipe(Effect.provide(serviceLayers))
      );
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    // Return empty array on error instead of throwing
    retry: false,
    placeholderData: [],
  });
}

/**
 * Fetch all recent conversations (across all projects)
 */
export function useAllConversations(limit: number = 50) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', 'all', limit],
    queryFn: async () => {
      const program = Effect.gen(function* () {
        const service = yield* ConversationService;
        return yield* service.getRecentConversations(limit);
      });

      // Run the Effect program with both service layers
      const serviceLayers = Layer.merge(
        ConversationService.Default,
        SessionMetadataService.Default
      );

      return await Effect.runPromise(
        program.pipe(Effect.provide(serviceLayers))
      );
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
    // Return empty array on error instead of throwing
    retry: false,
    placeholderData: [],
  });
}
