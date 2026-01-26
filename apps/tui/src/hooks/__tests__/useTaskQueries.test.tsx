/**
 * Tests for useTaskQueries hook
 * Verifies config loading, field normalization, and validation
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useConfig } from "../useTaskQueries";

// Mock config-loader module
vi.mock("../../utils/config-loader", () => ({
  loadConfig: vi.fn(),
}));

// Import the mocked function
import { loadConfig as mockLoadConfig } from "../../utils/config-loader";

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

describe("useConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Clear any existing LINEAR_API_KEY env var
    delete process.env.LINEAR_API_KEY;
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete process.env.LINEAR_API_KEY;
  });

  describe("Field Normalization", () => {
    it("normalizes snake_case to camelCase for top-level fields", async () => {
      // The config-loader already normalizes, so this tests that the hook uses
      // the normalized config correctly
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_123",
          teamID: "team-456",
        },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_123",
          teamID: "team-456",
        },
        beads: undefined,
      });
    });

    it("handles undefined/null linear config", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "beads",
        linear: undefined,
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear).toBeUndefined();
    });
  });

  describe("Config Loading", () => {
    it("returns config when present", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: { apiKey: "workspace_key", teamID: "workspace_team" },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.apiKey).toBe("workspace_key");
      expect(result.current.data?.linear?.teamID).toBe("workspace_team");
    });

    it("returns empty config when no config files exist", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue(null);

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: undefined,
        linear: undefined,
      });
    });

    it("preserves beads config", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "beads",
        beads: { customField: "value" },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.issueTracker).toBe("beads");
      expect(result.current.data?.beads).toEqual({ customField: "value" });
    });
  });

  describe("Config Validation", () => {
    it("throws error when Linear selected but no linear config", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        // Missing linear config
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      expect((result.current.error as Error).message).toContain(
        "Linear is selected but no Linear configuration found"
      );
    });

    it("throws error when Linear selected but apiKey missing", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: { apiKey: "", teamID: "team-123" }, // Empty apiKey
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      const error = result.current.error as Error;
      expect(error.message).toContain("Linear API key is missing");
    });

    it("throws error when Linear selected but teamID missing", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: { apiKey: "lin_api_123", teamID: "" }, // Empty teamID
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toBeDefined();
      const error = result.current.error as Error;
      expect(error.message).toContain("Linear team ID is missing");
    });

    it("allows missing apiKey/teamID when Linear not selected", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "beads",
        // No linear config, which is fine for beads
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.issueTracker).toBe("beads");
    });

    it("allows missing apiKey/teamID when issueTracker is undefined", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: null,
        // No linear config
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Null becomes undefined in the hook
      expect(result.current.data?.issueTracker).toBeUndefined();
    });
  });

  describe("Integration with config-loader", () => {
    it("calls loadConfig from config-loader", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: { apiKey: "test_key", teamID: "test_team" },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockLoadConfig).toHaveBeenCalled();
    });

    it("config-loader handles env var priority (tested in config-loader.test.ts)", async () => {
      // This is just a smoke test - detailed env var priority testing is in config-loader.test.ts
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: { apiKey: "from_env", teamID: "team" },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data?.linear?.apiKey).toBe("from_env");
    });
  });

  describe("Backwards Compatibility", () => {
    it("handles config with all linear fields populated", async () => {
      vi.mocked(mockLoadConfig).mockReturnValue({
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test_fake_key_for_unit_testing_only",
          teamID: "820895fa-6dca-4faa-85be-81106080397a",
        },
      });

      const { result } = renderHook(() => useConfig(), {
        wrapper: createWrapper(),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual({
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test_fake_key_for_unit_testing_only",
          teamID: "820895fa-6dca-4faa-85be-81106080397a",
        },
        beads: undefined,
      });
    });
  });
});
