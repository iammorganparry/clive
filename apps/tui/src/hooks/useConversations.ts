/**
 * useConversations Hook
 * React Query hook for fetching Claude CLI conversations
 */

import { useQuery } from '@tanstack/react-query';
import { ConversationService, type Conversation } from '../services/ConversationService';

const conversationService = new ConversationService();

/**
 * Fetch recent conversations for a specific project
 */
export function useConversations(projectPath: string, limit: number = 20) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', projectPath, limit],
    queryFn: async () => {
      return await conversationService.getConversationsForProject(projectPath, limit);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch all recent conversations (across all projects)
 */
export function useAllConversations(limit: number = 50) {
  return useQuery<Conversation[]>({
    queryKey: ['conversations', 'all', limit],
    queryFn: async () => {
      return await conversationService.getRecentConversations(limit);
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnWindowFocus: false,
  });
}
