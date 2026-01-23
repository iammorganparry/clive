/**
 * Tests for useTaskQueries hook
 * Verifies config loading, field normalization, and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useConfig } from '../useTaskQueries';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

// Mock fs, os, and path modules
vi.mock('fs/promises');
vi.mock('os');
vi.mock('path');

// Helper to create wrapper with QueryClient
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useConfig', () => {
  const mockWorkspaceRoot = '/workspace';
  const mockHomeDir = '/home/user';

  beforeEach(() => {
    // Setup default mocks
    vi.mocked(os.homedir).mockReturnValue(mockHomeDir);
    vi.mocked(path.join).mockImplementation((...args) => args.join('/'));

    // Set workspace root
    process.env.CLIVE_WORKSPACE = mockWorkspaceRoot;

    // Clear any existing LINEAR_API_KEY env var
    delete process.env.LINEAR_API_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CLIVE_WORKSPACE;
    delete process.env.LINEAR_API_KEY;
  });

  describe('Field Normalization', () => {
    it('normalizes snake_case to camelCase for top-level fields', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issue_tracker: 'linear',
          linear: {
            apiKey: 'lin_api_123',
            teamID: 'team-456',
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: 'linear',
        linear: {
          apiKey: 'lin_api_123',
          teamID: 'team-456',
        },
        beads: undefined,
      });
    });

    it('normalizes snake_case to camelCase for nested linear fields', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issue_tracker: 'linear',
          linear: {
            api_key: 'lin_api_123',
            team_id: 'team-456',
            team_slug: 'TEAM',
            team_name: 'Team Name',
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear).toEqual({
        apiKey: 'lin_api_123',
        teamID: 'team-456',
      });
    });

    it('handles mixed case fields (prefers camelCase)', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear', // camelCase
          issue_tracker: 'beads', // snake_case (should be ignored)
          linear: {
            apiKey: 'lin_api_123', // camelCase
            api_key: 'wrong_key', // snake_case (should be ignored)
            teamID: 'team-456', // camelCase
            team_id: 'wrong_team', // snake_case (should be ignored)
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: 'linear',
        linear: {
          apiKey: 'lin_api_123',
          teamID: 'team-456',
        },
        beads: undefined,
      });
    });

    it('handles undefined/null linear config', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issue_tracker: 'beads',
          linear: null,
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear).toBeUndefined();
    });
  });

  describe('Config Loading Priority', () => {
    it('loads workspace config when present', async () => {
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(
          // Workspace config
          JSON.stringify({
            issue_tracker: 'linear',
            linear: { api_key: 'workspace_key', team_id: 'workspace_team' },
          })
        )
        .mockResolvedValueOnce(
          // Global config (should be ignored)
          JSON.stringify({
            issueTracker: 'linear',
            linear: { apiKey: 'global_key', teamID: 'global_team' },
          })
        );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Should use workspace config, NOT global
      expect(result.current.data?.linear?.apiKey).toBe('workspace_key');
      expect(result.current.data?.linear?.teamID).toBe('workspace_team');
    });

    it('loads global config when no workspace config exists', async () => {
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('ENOENT: no such file'))
        .mockResolvedValueOnce(
          // Global config
          JSON.stringify({
            issueTracker: 'linear',
            linear: { apiKey: 'global_key', teamID: 'global_team' },
          })
        );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.apiKey).toBe('global_key');
      expect(result.current.data?.linear?.teamID).toBe('global_team');
    });

    it('returns empty config when no config files exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT: no such file'));

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: undefined,
        linear: undefined,
      });
    });
  });

  describe('Config Validation', () => {
    it('throws error when Linear selected but no linear config', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          // Missing linear config
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect((result.current.error as Error).message).toContain(
        'Linear is selected but no Linear configuration found'
      );
    });

    it('throws error when Linear selected but apiKey missing in workspace config', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: { teamID: 'team-123' }, // Missing apiKey
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      const error = result.current.error as Error;
      expect(error.message).toContain('Linear API key is missing');
      expect(error.message).toContain('workspace config');
    });

    it('throws error when Linear selected but apiKey missing in global config', async () => {
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('ENOENT: no such file'))
        .mockResolvedValueOnce(
          JSON.stringify({
            issueTracker: 'linear',
            linear: { teamID: 'team-123' }, // Missing apiKey
          })
        );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      const error = result.current.error as Error;
      expect(error.message).toContain('Linear API key is missing');
      expect(error.message).toContain('global config');
    });

    it('throws error when Linear selected but teamID missing', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: { apiKey: 'lin_api_123' }, // Missing teamID
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      const error = result.current.error as Error;
      expect(error.message).toContain('Linear team ID is missing');
    });

    it('allows missing apiKey/teamID when Linear not selected', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'beads',
          linear: { teamID: 'team-123' }, // Missing apiKey, but that's OK
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.issueTracker).toBe('beads');
    });

    it('allows missing apiKey/teamID when issueTracker is undefined', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          // No issueTracker field
          linear: { teamID: 'team-123' }, // Missing apiKey, but that's OK
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.issueTracker).toBeUndefined();
    });
  });

  describe('Environment Variable Priority', () => {
    it('uses LINEAR_API_KEY env var over config file', async () => {
      process.env.LINEAR_API_KEY = 'env_api_key';

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: {
            apiKey: 'config_api_key', // Should be ignored
            teamID: 'team-456',
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Should use env var, NOT config file
      expect(result.current.data?.linear?.apiKey).toBe('env_api_key');
      expect(result.current.data?.linear?.teamID).toBe('team-456');
    });

    it('falls back to config file apiKey when env var not set', async () => {
      delete process.env.LINEAR_API_KEY;

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: {
            apiKey: 'config_api_key',
            teamID: 'team-456',
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.apiKey).toBe('config_api_key');
    });

    it('uses env var even when config has no apiKey field', async () => {
      process.env.LINEAR_API_KEY = 'env_api_key';

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: {
            teamID: 'team-456',
            // No apiKey in config
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.apiKey).toBe('env_api_key');
      expect(result.current.data?.linear?.teamID).toBe('team-456');
    });
  });

  describe('Backwards Compatibility', () => {
    it('handles old-style config with snake_case fields', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issue_tracker: 'linear',
          setup_completed: true,
          linear: {
            api_key: 'lin_api_fake_test_key_for_unit_tests_only',
            team_id: '820895fa-6dca-4faa-85be-81106080397a',
            team_slug: 'TRI',
            team_name: 'Product',
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: 'linear',
        linear: {
          apiKey: 'lin_api_fake_test_key_for_unit_tests_only',
          teamID: '820895fa-6dca-4faa-85be-81106080397a',
        },
        beads: undefined,
      });
    });

    it('handles teamId variant (with lowercase "d")', async () => {
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify({
          issueTracker: 'linear',
          linear: {
            apiKey: 'lin_api_123',
            teamId: 'team-456', // Lowercase "d"
          },
        })
      );

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.teamID).toBe('team-456');
    });
  });
});
