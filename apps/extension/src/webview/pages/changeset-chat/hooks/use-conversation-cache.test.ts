import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCachedConversation, saveCachedConversation } from './use-conversation-cache';

// Mock VSCode API
const mockGetState = vi.fn();
const mockSetState = vi.fn();

vi.mock('../../../services/vscode.js', () => ({
  getVSCodeAPI: () => ({
    getState: mockGetState,
    setState: mockSetState,
  }),
}));

describe('Conversation Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadCachedConversation', () => {
    it('should return null when branch name is empty', () => {
      const result = loadCachedConversation('', 'branch');
      
      expect(result).toBeNull();
    });

    it('should return null when no cached state exists', () => {
      mockGetState.mockReturnValue(undefined);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
    });

    it('should load valid cached conversation', () => {
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: [
            {
              id: '1',
              role: 'user' as const,
              parts: [{ type: 'text' as const, text: 'Test message' }],
              timestamp: new Date(),
            },
          ],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeDefined();
      if (result) {
        expect(result.messages).toHaveLength(1);
        expect(result.hasCompletedAnalysis).toBe(true);
        expect(result.scratchpadTodos).toEqual([]);
      }
    });

    it('should return null when cache is expired', () => {
      const sevenDaysAgo = Date.now() - (8 * 24 * 60 * 60 * 1000); // 8 days ago
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: [],
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: sevenDaysAgo,
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
    });

    it('should return null when cache structure is invalid (missing messages)', () => {
      const cachedData = {
        'changeset-chat:main:branch': {
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: Date.now(),
          // messages missing
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
    });

    it('should return null when cache structure is invalid (messages not array)', () => {
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: 'not an array',
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
    });

    it('should return null when cache structure is invalid (hasCompletedAnalysis not boolean)', () => {
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: [],
          hasCompletedAnalysis: 'true', // string instead of boolean
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
    });

    it('should handle different modes (branch vs uncommitted)', () => {
      const now = Date.now();
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: [{
            id: '1',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Branch message' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: now,
        },
        'changeset-chat:main:uncommitted': {
          messages: [{
            id: '2',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Uncommitted message' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: now,
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const branchResult = loadCachedConversation('main', 'branch');
      const uncommittedResult = loadCachedConversation('main', 'uncommitted');
      
      expect(branchResult).toBeDefined();
      expect(uncommittedResult).toBeDefined();
      if (branchResult && uncommittedResult) {
        const branchPart = branchResult.messages[0].parts[0];
        const uncommittedPart = uncommittedResult.messages[0].parts[0];
        if (branchPart.type === 'text' && uncommittedPart.type === 'text') {
          expect(branchPart.text).toBe('Branch message');
          expect(uncommittedPart.text).toBe('Uncommitted message');
        }
      }
    });

    it('should handle cache with scratchpad todos', () => {
      const cachedData = {
        'changeset-chat:main:branch': {
          messages: [],
          hasCompletedAnalysis: true,
          scratchpadTodos: [
            { id: 'todo-1', title: 'Test todo 1', section: 'Files to Analyze', completed: false },
            { id: 'todo-2', title: 'Test todo 2', section: 'Progress', completed: true },
          ],
          cachedAt: Date.now(),
        },
      };
      
      mockGetState.mockReturnValue(cachedData);
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeDefined();
      if (result) {
        expect(result.scratchpadTodos).toHaveLength(2);
        expect(result.scratchpadTodos[0].title).toBe('Test todo 1');
        expect(result.scratchpadTodos[1].completed).toBe(true);
      }
    });

    it('should handle errors gracefully', () => {
      mockGetState.mockImplementation(() => {
        throw new Error('VSCode API error');
      });
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = loadCachedConversation('main', 'branch');
      
      expect(result).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to load cached conversation:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });
  });

  describe('saveCachedConversation', () => {
    it('should not save when branch name is empty', () => {
      saveCachedConversation('', 'branch', {
        messages: [],
        hasCompletedAnalysis: false,
        scratchpadTodos: [],
        cachedAt: Date.now(),
      });
      
      expect(mockSetState).not.toHaveBeenCalled();
    });

    it('should save conversation to cache with current timestamp', () => {
      mockGetState.mockReturnValue({});
      const beforeSave = Date.now();
      
      saveCachedConversation('main', 'branch', {
        messages: [{
          id: '1',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: 'Test' }],
          timestamp: new Date(),
        }],
        hasCompletedAnalysis: true,
        scratchpadTodos: [],
        cachedAt: 0, // should be overridden
      });
      
      const afterSave = Date.now();
      
      expect(mockSetState).toHaveBeenCalledTimes(1);
      const savedState = mockSetState.mock.calls[0][0];
      expect(savedState['changeset-chat:main:branch']).toBeDefined();
      expect(savedState['changeset-chat:main:branch'].messages).toHaveLength(1);
      expect(savedState['changeset-chat:main:branch'].cachedAt).toBeGreaterThanOrEqual(beforeSave);
      expect(savedState['changeset-chat:main:branch'].cachedAt).toBeLessThanOrEqual(afterSave);
    });

    it('should merge with existing cache state', () => {
      const existingState = {
        'changeset-chat:develop:branch': {
          messages: [{
            id: '1',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Existing' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
      };
      
      mockGetState.mockReturnValue(existingState);
      
      saveCachedConversation('main', 'uncommitted', {
        messages: [{
          id: '2',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: 'New' }],
          timestamp: new Date(),
        }],
        hasCompletedAnalysis: false,
        scratchpadTodos: [],
        cachedAt: Date.now(),
      });
      
      expect(mockSetState).toHaveBeenCalledTimes(1);
      const savedState = mockSetState.mock.calls[0][0];
      
      // Should preserve existing cache entries
      expect(savedState['changeset-chat:develop:branch']).toBeDefined();
      expect(savedState['changeset-chat:develop:branch'].messages[0].parts[0].text).toBe('Existing');
      
      // Should add new cache entry
      expect(savedState['changeset-chat:main:uncommitted']).toBeDefined();
      expect(savedState['changeset-chat:main:uncommitted'].messages[0].parts[0].text).toBe('New');
    });

    it('should save scratchpad todos', () => {
      mockGetState.mockReturnValue({});
      
      saveCachedConversation('main', 'branch', {
        messages: [],
        hasCompletedAnalysis: true,
        scratchpadTodos: [
          { id: 'todo-1', title: 'Todo 1', section: 'Files to Analyze', completed: false },
          { id: 'todo-2', title: 'Todo 2', section: 'Progress', completed: true },
        ],
        cachedAt: Date.now(),
      });
      
      const savedState = mockSetState.mock.calls[0][0];
      expect(savedState['changeset-chat:main:branch'].scratchpadTodos).toHaveLength(2);
      expect(savedState['changeset-chat:main:branch'].scratchpadTodos[0].title).toBe('Todo 1');
    });

    it('should handle errors gracefully', () => {
      mockGetState.mockReturnValue({});
      mockSetState.mockImplementation(() => {
        throw new Error('VSCode API error');
      });
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      // Should not throw
      expect(() => {
        saveCachedConversation('main', 'branch', {
          messages: [],
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        });
      }).not.toThrow();
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to save cached conversation:',
        expect.any(Error)
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle null existing state', () => {
      mockGetState.mockReturnValue(null);
      
      saveCachedConversation('main', 'branch', {
        messages: [{
          id: '1',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: 'Test' }],
          timestamp: new Date(),
        }],
        hasCompletedAnalysis: false,
        scratchpadTodos: [],
        cachedAt: Date.now(),
      });
      
      expect(mockSetState).toHaveBeenCalledTimes(1);
      const savedState = mockSetState.mock.calls[0][0];
      expect(savedState['changeset-chat:main:branch']).toBeDefined();
    });

    it('should overwrite existing cache for same branch and mode', () => {
      const existingState = {
        'changeset-chat:main:branch': {
          messages: [{
            id: '1',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Old' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: Date.now() - 1000,
        },
      };
      
      mockGetState.mockReturnValue(existingState);
      
      saveCachedConversation('main', 'branch', {
        messages: [{
          id: '2',
          role: 'user' as const,
          parts: [{ type: 'text' as const, text: 'New' }],
          timestamp: new Date(),
        }],
        hasCompletedAnalysis: false,
        scratchpadTodos: [
          { id: 'todo-1', title: 'New todo', section: 'Files to Analyze', completed: false },
        ],
        cachedAt: Date.now(),
      });
      
      const savedState = mockSetState.mock.calls[0][0];
      expect(savedState['changeset-chat:main:branch'].messages[0].parts[0].text).toBe('New');
      expect(savedState['changeset-chat:main:branch'].hasCompletedAnalysis).toBe(false);
      expect(savedState['changeset-chat:main:branch'].scratchpadTodos).toHaveLength(1);
    });
  });

  describe('Cache key generation', () => {
    it('should generate different keys for different branches', () => {
      mockGetState.mockReturnValue({
        'changeset-chat:main:branch': {
          messages: [{
            id: '1',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Main' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
        'changeset-chat:develop:branch': {
          messages: [{
            id: '2',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Develop' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: Date.now(),
        },
      });
      
      const mainResult = loadCachedConversation('main', 'branch');
      const developResult = loadCachedConversation('develop', 'branch');
      
      expect(mainResult).toBeDefined();
      expect(developResult).toBeDefined();
      if (mainResult && developResult) {
        const mainPart = mainResult.messages[0].parts[0];
        const developPart = developResult.messages[0].parts[0];
        if (mainPart.type === 'text' && developPart.type === 'text') {
          expect(mainPart.text).toBe('Main');
          expect(developPart.text).toBe('Develop');
        }
      }
    });

    it('should generate different keys for different modes', () => {
      const now = Date.now();
      mockGetState.mockReturnValue({
        'changeset-chat:main:branch': {
          messages: [{
            id: '1',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Branch' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: true,
          scratchpadTodos: [],
          cachedAt: now,
        },
        'changeset-chat:main:uncommitted': {
          messages: [{
            id: '2',
            role: 'user' as const,
            parts: [{ type: 'text' as const, text: 'Uncommitted' }],
            timestamp: new Date(),
          }],
          hasCompletedAnalysis: false,
          scratchpadTodos: [],
          cachedAt: now,
        },
      });
      
      const branchResult = loadCachedConversation('main', 'branch');
      const uncommittedResult = loadCachedConversation('main', 'uncommitted');
      
      expect(branchResult).toBeDefined();
      expect(uncommittedResult).toBeDefined();
      if (branchResult && uncommittedResult) {
        const branchPart = branchResult.messages[0].parts[0];
        const uncommittedPart = uncommittedResult.messages[0].parts[0];
        if (branchPart.type === 'text' && uncommittedPart.type === 'text') {
          expect(branchPart.text).toBe('Branch');
          expect(uncommittedPart.text).toBe('Uncommitted');
        }
      }
    });
  });
});
