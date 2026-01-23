/**
 * useSelectionState Hook
 * XState machine for managing two-level selection flow (Issues -> Conversations)
 */

import { useEffect, useRef } from 'react';
import { setup, assign } from 'xstate';
import { useMachine } from '@xstate/react';
import type { Session } from '../types';
import type { Conversation } from '../services/ConversationService';

export interface SelectionContext {
  // Level tracking
  selectedIssue: Session | null;

  // Selection state
  selectedIndex: number;
  searchQuery: string;

  // Data
  sessions: Session[];
  conversations: Conversation[];
}

export type SelectionEvent =
  | { type: 'SELECT_ISSUE'; issue: Session }
  | { type: 'SELECT_CONVERSATION'; conversation: Conversation }
  | { type: 'CREATE_NEW'; issue?: Session }
  | { type: 'GO_BACK' }
  | { type: 'SEARCH'; query: string }
  | { type: 'CLEAR_SEARCH' }
  | { type: 'NAVIGATE_UP' }
  | { type: 'NAVIGATE_DOWN' }
  | { type: 'UPDATE_DATA'; sessions: Session[]; conversations: Conversation[] };

/**
 * Selection State Machine
 * Two-level hierarchy: level1 (issues) -> level2 (conversations)
 */
const selectionMachine = setup({
  types: {
    context: {} as SelectionContext,
    events: {} as SelectionEvent,
  },
  actions: {
    selectIssue: assign({
      selectedIssue: ({ event }) => {
        if (event.type !== 'SELECT_ISSUE') return null;
        return event.issue;
      },
      selectedIndex: -1, // Reset to "Create New" position
      searchQuery: '', // Clear search when changing levels
    }),
    goBackToLevel1: assign({
      selectedIssue: null,
      selectedIndex: 0,
      searchQuery: '',
    }),
    updateSearch: assign({
      searchQuery: ({ event }) => {
        if (event.type !== 'SEARCH') return '';
        return event.query;
      },
      selectedIndex: 0, // Reset selection when searching
    }),
    clearSearch: assign({
      searchQuery: '',
      selectedIndex: 0,
    }),
    navigateUp: assign({
      selectedIndex: ({ context }) => {
        const { selectedIssue, selectedIndex, searchQuery, sessions, conversations } = context;

        if (!selectedIssue) {
          // Level 1: Navigate issues
          // Include "Other Conversations" in navigation calculation
          const unattachedCount = conversations.filter(c => !c.linearProjectId && !c.linearTaskId).length;

          const filteredSessions = searchQuery
            ? sessions.filter(s => {
                const query = searchQuery.toLowerCase();
                const identifier = s.linearData?.identifier?.toLowerCase() || '';
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : sessions;

          // Add 1 for "Other Conversations" if there are unattached conversations
          const totalItems = unattachedCount > 0 ? filteredSessions.length + 1 : filteredSessions.length;
          const maxIndex = Math.min(totalItems - 1, 9);
          const minIndex = searchQuery ? 0 : -1; // Allow -1 for "Create New"

          return selectedIndex > minIndex ? selectedIndex - 1 : maxIndex;
        } else {
          // Level 2: Navigate conversations
          // Check if this is the "Other Conversations" group (no linearData)
          const isUnattachedGroup = !selectedIssue.linearData;

          const conversationsForIssue = isUnattachedGroup
            ? conversations.filter(c => !c.linearProjectId && !c.linearTaskId)
            : conversations.filter(c => {
                const issueLinearId = selectedIssue.linearData?.id;
                return c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId;
              });

          const filteredConversations = searchQuery
            ? conversationsForIssue.filter(c => {
                const query = searchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || '';
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const maxIndex = Math.min(filteredConversations.length - 1, 9);
          // Don't allow "Create New" for unattached group
          const minIndex = (searchQuery || isUnattachedGroup) ? 0 : -1;

          return selectedIndex > minIndex ? selectedIndex - 1 : maxIndex;
        }
      },
    }),
    navigateDown: assign({
      selectedIndex: ({ context }) => {
        const { selectedIssue, selectedIndex, searchQuery, sessions, conversations } = context;

        if (!selectedIssue) {
          // Level 1: Navigate issues
          // Include "Other Conversations" in navigation calculation
          const unattachedCount = conversations.filter(c => !c.linearProjectId && !c.linearTaskId).length;

          const filteredSessions = searchQuery
            ? sessions.filter(s => {
                const query = searchQuery.toLowerCase();
                const identifier = s.linearData?.identifier?.toLowerCase() || '';
                const title = s.name.toLowerCase();
                return identifier.includes(query) || title.includes(query);
              })
            : sessions;

          // Add 1 for "Other Conversations" if there are unattached conversations
          const totalItems = unattachedCount > 0 ? filteredSessions.length + 1 : filteredSessions.length;
          const maxIndex = Math.min(totalItems - 1, 9);
          const minIndex = searchQuery ? 0 : -1; // Allow -1 for "Create New"

          return selectedIndex < maxIndex ? selectedIndex + 1 : minIndex;
        } else {
          // Level 2: Navigate conversations
          // Check if this is the "Other Conversations" group (no linearData)
          const isUnattachedGroup = !selectedIssue.linearData;

          const conversationsForIssue = isUnattachedGroup
            ? conversations.filter(c => !c.linearProjectId && !c.linearTaskId)
            : conversations.filter(c => {
                const issueLinearId = selectedIssue.linearData?.id;
                return c.linearProjectId === issueLinearId || c.linearTaskId === issueLinearId;
              });

          const filteredConversations = searchQuery
            ? conversationsForIssue.filter(c => {
                const query = searchQuery.toLowerCase();
                const display = c.display.toLowerCase();
                const slug = c.slug?.toLowerCase() || '';
                return display.includes(query) || slug.includes(query);
              })
            : conversationsForIssue;

          const maxIndex = Math.min(filteredConversations.length - 1, 9);
          // Don't allow "Create New" for unattached group
          const minIndex = (searchQuery || isUnattachedGroup) ? 0 : -1;

          return selectedIndex < maxIndex ? selectedIndex + 1 : minIndex;
        }
      },
    }),
    updateData: assign({
      sessions: ({ event }) => {
        if (event.type !== 'UPDATE_DATA') return [];
        return event.sessions;
      },
      conversations: ({ event }) => {
        if (event.type !== 'UPDATE_DATA') return [];
        return event.conversations;
      },
    }),
  },
}).createMachine({
  id: 'selection',
  initial: 'level1',
  context: {
    selectedIssue: null,
    selectedIndex: -1, // Start at "Create New"
    searchQuery: '',
    sessions: [],
    conversations: [],
  },
  states: {
    level1: {
      id: 'level1',
      on: {
        SELECT_ISSUE: {
          target: 'level2',
          actions: 'selectIssue',
        },
        CREATE_NEW: {
          // Stay in level1, emit event to parent
        },
        SEARCH: {
          actions: 'updateSearch',
        },
        CLEAR_SEARCH: {
          actions: 'clearSearch',
        },
        NAVIGATE_UP: {
          actions: 'navigateUp',
        },
        NAVIGATE_DOWN: {
          actions: 'navigateDown',
        },
        UPDATE_DATA: {
          actions: 'updateData',
        },
      },
    },
    level2: {
      id: 'level2',
      on: {
        SELECT_CONVERSATION: {
          // Stay in level2, emit event to parent
        },
        CREATE_NEW: {
          // Stay in level2, emit event to parent
        },
        GO_BACK: {
          target: 'level1',
          actions: 'goBackToLevel1',
        },
        SEARCH: {
          actions: 'updateSearch',
        },
        CLEAR_SEARCH: {
          actions: 'clearSearch',
        },
        NAVIGATE_UP: {
          actions: 'navigateUp',
        },
        NAVIGATE_DOWN: {
          actions: 'navigateDown',
        },
        UPDATE_DATA: {
          actions: 'updateData',
        },
      },
    },
  },
});

export function useSelectionState(sessions: Session[], conversations: Conversation[]) {
  const [state, send] = useMachine(selectionMachine);

  // Track previous lengths to avoid infinite loops
  const prevLengthsRef = useRef({ sessions: 0, conversations: 0 });

  // Update data when props change (only on length change to avoid infinite loops)
  useEffect(() => {
    const sessionsLength = sessions.length;
    const conversationsLength = conversations.length;

    if (
      prevLengthsRef.current.sessions !== sessionsLength ||
      prevLengthsRef.current.conversations !== conversationsLength
    ) {
      prevLengthsRef.current = { sessions: sessionsLength, conversations: conversationsLength };
      send({ type: 'UPDATE_DATA', sessions, conversations });
    }
  }, [sessions, conversations]);

  return {
    // State
    selectedIssue: state.context.selectedIssue,
    selectedIndex: state.context.selectedIndex,
    searchQuery: state.context.searchQuery,
    isLevel1: state.matches('level1'),
    isLevel2: state.matches('level2'),

    // Actions
    selectIssue: (issue: Session) => send({ type: 'SELECT_ISSUE', issue }),
    selectConversation: (conversation: Conversation) => send({ type: 'SELECT_CONVERSATION', conversation }),
    createNew: (issue?: Session) => send({ type: 'CREATE_NEW', issue }),
    goBack: () => send({ type: 'GO_BACK' }),
    search: (query: string) => send({ type: 'SEARCH', query }),
    clearSearch: () => send({ type: 'CLEAR_SEARCH' }),
    navigateUp: () => send({ type: 'NAVIGATE_UP' }),
    navigateDown: () => send({ type: 'NAVIGATE_DOWN' }),
  };
}
