import { useCallback, useEffect, useRef } from "react";
import { getVSCodeAPI } from "../../../services/vscode.js";
import type { ChatMessage } from "../../../types/chat.js";
import type { ScratchpadTodo } from "../utils/parse-scratchpad.js";

interface CachedConversation {
  messages: ChatMessage[];
  hasCompletedAnalysis: boolean;
  scratchpadTodos: ScratchpadTodo[];
  cachedAt: number; // timestamp for cache invalidation
}

const CACHE_KEY_PREFIX = "changeset-chat:";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Get cache key for a branch and mode
 */
function getCacheKey(branchName: string, mode: "branch" | "uncommitted"): string {
  return `${CACHE_KEY_PREFIX}${branchName}:${mode}`;
}

/**
 * Load cached conversation for a branch and mode
 */
export function loadCachedConversation(
  branchName: string,
  mode: "branch" | "uncommitted",
): CachedConversation | null {
  if (!branchName) return null;

  try {
    const vscode = getVSCodeAPI();
    const cached = vscode.getState() as Record<string, unknown> | undefined;

    if (!cached) return null;

    const cacheKey = getCacheKey(branchName, mode);
    const branchCache = cached[cacheKey];

    if (!branchCache || typeof branchCache !== "object") return null;

    const conversation = branchCache as Partial<CachedConversation>;

    // Validate cache structure
    if (
      !Array.isArray(conversation.messages) ||
      typeof conversation.hasCompletedAnalysis !== "boolean" ||
      !Array.isArray(conversation.scratchpadTodos) ||
      typeof conversation.cachedAt !== "number"
    ) {
      return null;
    }

    // Check if cache is expired
    const now = Date.now();
    if (now - conversation.cachedAt > CACHE_TTL) {
      return null;
    }

    return {
      messages: conversation.messages,
      hasCompletedAnalysis: conversation.hasCompletedAnalysis,
      scratchpadTodos: conversation.scratchpadTodos,
      cachedAt: conversation.cachedAt,
    };
  } catch (error) {
    console.warn("Failed to load cached conversation:", error);
    return null;
  }
}

/**
 * Save conversation to cache
 */
export function saveCachedConversation(
  branchName: string,
  mode: "branch" | "uncommitted",
  conversation: CachedConversation,
): void {
  if (!branchName) return;

  try {
    const vscode = getVSCodeAPI();
    const currentState = (vscode.getState() as Record<string, unknown>) || {};
    const cacheKey = getCacheKey(branchName, mode);

    vscode.setState({
      ...currentState,
      [cacheKey]: {
        ...conversation,
        cachedAt: Date.now(),
      },
    });
  } catch (error) {
    console.warn("Failed to save cached conversation:", error);
  }
}

/**
 * Clear cached conversation for a branch and mode
 */
export function clearCachedConversation(
  branchName: string,
  mode: "branch" | "uncommitted",
): void {
  if (!branchName) return;

  try {
    const vscode = getVSCodeAPI();
    const currentState = (vscode.getState() as Record<string, unknown>) || {};
    const cacheKey = getCacheKey(branchName, mode);

    const { [cacheKey]: _removed, ...rest } = currentState;
    vscode.setState(rest);
  } catch (error) {
    console.warn("Failed to clear cached conversation:", error);
  }
}

/**
 * Hook for managing conversation cache with debounced writes
 */
export function useConversationCache(
  branchName: string,
  mode: "branch" | "uncommitted",
) {
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<CachedConversation | null>(null);

  // Debounced save function
  const debouncedSave = useCallback(
    (conversation: CachedConversation) => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout
      saveTimeoutRef.current = setTimeout(() => {
        saveCachedConversation(branchName, mode, conversation);
        lastSavedRef.current = conversation;
        saveTimeoutRef.current = null;
      }, 500); // 500ms debounce
    },
    [branchName, mode],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      // Save immediately on unmount if there's pending data
      if (lastSavedRef.current) {
        saveCachedConversation(branchName, mode, lastSavedRef.current);
      }
    };
  }, [branchName, mode]);

  return {
    load: useCallback(
      () => loadCachedConversation(branchName, mode),
      [branchName, mode],
    ),
    save: debouncedSave,
    clear: useCallback(
      () => clearCachedConversation(branchName, mode),
      [branchName, mode],
    ),
  };
}
