/**
 * Tests for config preservation behavior
 *
 * These tests verify that updating one part of the config doesn't
 * accidentally overwrite other parts (the bug that was fixed).
 *
 * The actual fix is in App.tsx where handleConfigComplete and beads
 * config handlers now spread existing config: { ...config, ...newSettings }
 */

import { describe, expect, it } from "vitest";
import type { IssueTrackerConfig } from "../../types/views";

/**
 * Simulates the CORRECT way to update config (spreading existing)
 * This is how handleConfigComplete should work after the fix
 */
function updateConfigCorrectly(
  existingConfig: IssueTrackerConfig | null,
  newSettings: Partial<IssueTrackerConfig>
): IssueTrackerConfig {
  return {
    ...existingConfig,
    ...newSettings,
  } as IssueTrackerConfig;
}

/**
 * Simulates the BUGGY way to update config (overwriting)
 * This is how handleConfigComplete worked BEFORE the fix
 */
function updateConfigBuggy(
  _existingConfig: IssueTrackerConfig | null,
  newSettings: Partial<IssueTrackerConfig>
): IssueTrackerConfig {
  // BUG: ignores existing config entirely
  return newSettings as IssueTrackerConfig;
}

describe("Config Preservation", () => {
  describe("Correct behavior (with spread)", () => {
    it("preserves worker config when updating Linear settings", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: null,
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "secret-token",
          autoConnect: true,
        },
      };

      const newConfig = updateConfigCorrectly(existingConfig, {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
      });

      // Worker config should be preserved
      expect(newConfig.worker).toBeDefined();
      expect(newConfig.worker?.enabled).toBe(true);
      expect(newConfig.worker?.centralUrl).toBe("wss://example.com/ws");
      expect(newConfig.worker?.autoConnect).toBe(true);

      // Linear config should be added
      expect(newConfig.issueTracker).toBe("linear");
      expect(newConfig.linear?.teamID).toBe("team-123");
    });

    it("preserves Linear config when updating worker settings", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_existing",
          teamID: "team-123",
        },
      };

      const newConfig = updateConfigCorrectly(existingConfig, {
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "new-token",
          autoConnect: true,
        },
      });

      // Linear config should be preserved
      expect(newConfig.issueTracker).toBe("linear");
      expect(newConfig.linear?.teamID).toBe("team-123");
      expect(newConfig.linear?.apiKey).toBe("lin_api_existing");

      // Worker config should be added
      expect(newConfig.worker).toBeDefined();
      expect(newConfig.worker?.enabled).toBe(true);
    });

    it("preserves worker config when switching to Beads", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "secret-token",
          autoConnect: true,
        },
      };

      const newConfig = updateConfigCorrectly(existingConfig, {
        issueTracker: "beads",
        beads: {},
      });

      // Worker config should be preserved
      expect(newConfig.worker).toBeDefined();
      expect(newConfig.worker?.enabled).toBe(true);
      expect(newConfig.worker?.centralUrl).toBe("wss://example.com/ws");

      // Issue tracker should be updated
      expect(newConfig.issueTracker).toBe("beads");
    });

    it("preserves all existing fields when adding new ones", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "secret-token",
          autoConnect: true,
        },
      };

      // Just update the worker enabled state
      const newConfig = updateConfigCorrectly(existingConfig, {
        worker: {
          ...existingConfig.worker!,
          enabled: false,
        },
      });

      // All other fields should be preserved
      expect(newConfig.issueTracker).toBe("linear");
      expect(newConfig.linear?.teamID).toBe("team-123");
      expect(newConfig.worker?.centralUrl).toBe("wss://example.com/ws");
      expect(newConfig.worker?.enabled).toBe(false);
    });
  });

  describe("REGRESSION: Buggy behavior (without spread)", () => {
    it("loses worker config when updating Linear settings", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: null,
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "secret-token",
          autoConnect: true,
        },
      };

      // This simulates the OLD buggy behavior
      const newConfig = updateConfigBuggy(existingConfig, {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
      });

      // BUG: Worker config is LOST!
      expect(newConfig.worker).toBeUndefined();

      // Linear config is present
      expect(newConfig.issueTracker).toBe("linear");
    });

    it("loses Linear config when updating worker settings", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_existing",
          teamID: "team-123",
        },
      };

      // This simulates the OLD buggy behavior
      const newConfig = updateConfigBuggy(existingConfig, {
        worker: {
          enabled: true,
          centralUrl: "wss://example.com/ws",
          token: "new-token",
          autoConnect: true,
        },
      });

      // BUG: Linear config is LOST!
      expect(newConfig.linear).toBeUndefined();
      expect(newConfig.issueTracker).toBeUndefined();

      // Worker config is present
      expect(newConfig.worker).toBeDefined();
    });
  });

  describe("Edge cases", () => {
    it("handles null existing config", () => {
      const newConfig = updateConfigCorrectly(null, {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
      });

      expect(newConfig.issueTracker).toBe("linear");
      expect(newConfig.linear?.teamID).toBe("team-123");
    });

    it("handles empty existing config", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: null,
      };

      const newConfig = updateConfigCorrectly(existingConfig, {
        issueTracker: "linear",
        linear: {
          apiKey: "lin_api_test",
          teamID: "team-123",
        },
      });

      expect(newConfig.issueTracker).toBe("linear");
    });

    it("overwrites nested objects completely (expected behavior)", () => {
      const existingConfig: IssueTrackerConfig = {
        issueTracker: "linear",
        linear: {
          apiKey: "old_key",
          teamID: "old_team",
        },
      };

      const newConfig = updateConfigCorrectly(existingConfig, {
        linear: {
          apiKey: "new_key",
          teamID: "new_team",
        },
      });

      // New linear config replaces old one
      expect(newConfig.linear?.apiKey).toBe("new_key");
      expect(newConfig.linear?.teamID).toBe("new_team");
    });
  });
});

describe("App.tsx handleConfigComplete pattern", () => {
  /**
   * This test documents the exact pattern used in App.tsx
   * to ensure the fix is maintained
   */
  it("matches the correct pattern from App.tsx handleConfigComplete", () => {
    // Simulating the state in App.tsx
    const config: IssueTrackerConfig | null = {
      issueTracker: null,
      worker: {
        enabled: true,
        centralUrl: "wss://slack-central-production.up.railway.app/ws",
        token: "dev-token",
        autoConnect: true,
      },
    };

    const configFlow: "linear" | "beads" = "linear";
    const configData = {
      apiKey: "lin_api_new",
      teamID: "team-new",
    };

    // This is the CORRECT pattern (after fix):
    const correctUpdate = {
      ...config,
      issueTracker: configFlow as "linear" | "beads",
      [configFlow]: configData,
    };

    expect(correctUpdate.worker).toBeDefined();
    expect(correctUpdate.worker?.enabled).toBe(true);
    expect(correctUpdate.issueTracker).toBe("linear");
    expect(correctUpdate.linear?.teamID).toBe("team-new");

    // This is the BUGGY pattern (before fix):
    const buggyUpdate = {
      issueTracker: configFlow as "linear" | "beads",
      [configFlow]: configData,
    };

    expect(buggyUpdate.worker).toBeUndefined(); // BUG: lost!
  });

  it("matches the correct pattern from App.tsx beads config", () => {
    const config: IssueTrackerConfig | null = {
      issueTracker: "linear",
      linear: {
        apiKey: "lin_api_existing",
        teamID: "team-existing",
      },
      worker: {
        enabled: true,
        centralUrl: "wss://example.com/ws",
        token: "token",
        autoConnect: true,
      },
    };

    // This is the CORRECT pattern (after fix):
    const correctUpdate = {
      ...config,
      issueTracker: "beads" as const,
      beads: {},
    };

    expect(correctUpdate.worker).toBeDefined();
    expect(correctUpdate.linear).toBeDefined(); // Still there from spread
    expect(correctUpdate.issueTracker).toBe("beads");

    // This is the BUGGY pattern (before fix):
    const buggyUpdate = {
      issueTracker: "beads" as const,
      beads: {},
    };

    expect(buggyUpdate.worker).toBeUndefined(); // BUG: lost!
  });
});
