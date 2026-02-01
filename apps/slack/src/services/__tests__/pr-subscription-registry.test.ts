/**
 * Tests for PrSubscriptionRegistry
 *
 * Verifies subscription lifecycle, lookup, and edge cases
 * for tracking PR → worker/session mappings.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrSubscriptionRegistry } from "../pr-subscription-registry";

describe("PrSubscriptionRegistry", () => {
  let registry: PrSubscriptionRegistry;

  const baseSub = {
    prUrl: "https://github.com/owner/repo/pull/42",
    prNumber: 42,
    repo: "owner/repo",
    workerId: "worker-123",
    claudeSessionId: "claude-abc",
    projectId: "proj-1",
    channel: "C123",
    threadTs: "1234567890.123456",
    initiatorId: "U123",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new PrSubscriptionRegistry();
  });

  afterEach(() => {
    registry.closeAll();
    vi.useRealTimers();
  });

  describe("subscribe", () => {
    it("creates a subscription with a subscribedAt timestamp", () => {
      registry.subscribe(baseSub);

      const sub = registry.getSubscription("owner/repo", 42);
      expect(sub).toBeDefined();
      expect(sub!.prUrl).toBe(baseSub.prUrl);
      expect(sub!.prNumber).toBe(42);
      expect(sub!.repo).toBe("owner/repo");
      expect(sub!.workerId).toBe("worker-123");
      expect(sub!.claudeSessionId).toBe("claude-abc");
      expect(sub!.projectId).toBe("proj-1");
      expect(sub!.channel).toBe("C123");
      expect(sub!.threadTs).toBe("1234567890.123456");
      expect(sub!.initiatorId).toBe("U123");
      expect(sub!.subscribedAt).toBeInstanceOf(Date);
      expect(sub!.lastFeedbackAt).toBeUndefined();
    });

    it("increments count on subscribe", () => {
      expect(registry.count).toBe(0);
      registry.subscribe(baseSub);
      expect(registry.count).toBe(1);
    });

    it("overwrites an existing subscription for the same PR", () => {
      registry.subscribe(baseSub);
      registry.subscribe({ ...baseSub, workerId: "worker-456" });

      const sub = registry.getSubscription("owner/repo", 42);
      expect(sub!.workerId).toBe("worker-456");
      expect(registry.count).toBe(1);
    });

    it("handles multiple distinct subscriptions", () => {
      registry.subscribe(baseSub);
      registry.subscribe({ ...baseSub, prNumber: 43, prUrl: "https://github.com/owner/repo/pull/43" });
      registry.subscribe({ ...baseSub, repo: "other/repo", prUrl: "https://github.com/other/repo/pull/42" });

      expect(registry.count).toBe(3);
      expect(registry.getSubscription("owner/repo", 42)).toBeDefined();
      expect(registry.getSubscription("owner/repo", 43)).toBeDefined();
      expect(registry.getSubscription("other/repo", 42)).toBeDefined();
    });
  });

  describe("unsubscribe", () => {
    it("removes an existing subscription", () => {
      registry.subscribe(baseSub);
      expect(registry.count).toBe(1);

      registry.unsubscribe("owner/repo", 42);
      expect(registry.count).toBe(0);
      expect(registry.getSubscription("owner/repo", 42)).toBeUndefined();
    });

    it("is a no-op for non-existent subscriptions", () => {
      registry.unsubscribe("owner/repo", 99);
      expect(registry.count).toBe(0);
    });

    it("only removes the specified subscription", () => {
      registry.subscribe(baseSub);
      registry.subscribe({ ...baseSub, prNumber: 43, prUrl: "https://github.com/owner/repo/pull/43" });

      registry.unsubscribe("owner/repo", 42);
      expect(registry.count).toBe(1);
      expect(registry.getSubscription("owner/repo", 43)).toBeDefined();
    });
  });

  describe("getSubscription", () => {
    it("returns undefined for non-existent subscriptions", () => {
      expect(registry.getSubscription("owner/repo", 42)).toBeUndefined();
    });

    it("looks up case-insensitively on repo name", () => {
      registry.subscribe(baseSub);

      expect(registry.getSubscription("Owner/Repo", 42)).toBeDefined();
      expect(registry.getSubscription("OWNER/REPO", 42)).toBeDefined();
      expect(registry.getSubscription("owner/repo", 42)).toBeDefined();
    });

    it("returns undefined for correct repo but wrong PR number", () => {
      registry.subscribe(baseSub);
      expect(registry.getSubscription("owner/repo", 99)).toBeUndefined();
    });

    it("returns undefined for correct PR number but wrong repo", () => {
      registry.subscribe(baseSub);
      expect(registry.getSubscription("other/repo", 42)).toBeUndefined();
    });
  });

  describe("getSubscriptionsForWorker", () => {
    it("returns all subscriptions for a given worker", () => {
      registry.subscribe(baseSub);
      registry.subscribe({ ...baseSub, prNumber: 43, prUrl: "https://github.com/owner/repo/pull/43" });
      registry.subscribe({ ...baseSub, prNumber: 44, prUrl: "https://github.com/owner/repo/pull/44", workerId: "worker-456" });

      const subs = registry.getSubscriptionsForWorker("worker-123");
      expect(subs).toHaveLength(2);
      expect(subs.map((s) => s.prNumber).sort()).toEqual([42, 43]);
    });

    it("returns empty array for unknown worker", () => {
      registry.subscribe(baseSub);
      expect(registry.getSubscriptionsForWorker("worker-999")).toEqual([]);
    });

    it("returns empty array when registry is empty", () => {
      expect(registry.getSubscriptionsForWorker("worker-123")).toEqual([]);
    });
  });

  describe("touchFeedback", () => {
    it("sets lastFeedbackAt timestamp", () => {
      registry.subscribe(baseSub);

      const before = registry.getSubscription("owner/repo", 42);
      expect(before!.lastFeedbackAt).toBeUndefined();

      registry.touchFeedback("owner/repo", 42);

      const after = registry.getSubscription("owner/repo", 42);
      expect(after!.lastFeedbackAt).toBeInstanceOf(Date);
    });

    it("updates lastFeedbackAt on subsequent touches", () => {
      registry.subscribe(baseSub);

      registry.touchFeedback("owner/repo", 42);
      const first = registry.getSubscription("owner/repo", 42)!.lastFeedbackAt!.getTime();

      vi.advanceTimersByTime(5000);

      registry.touchFeedback("owner/repo", 42);
      const second = registry.getSubscription("owner/repo", 42)!.lastFeedbackAt!.getTime();

      expect(second).toBeGreaterThan(first);
    });

    it("is a no-op for non-existent subscriptions", () => {
      // Should not throw
      registry.touchFeedback("owner/repo", 99);
    });
  });

  describe("closeAll", () => {
    it("removes all subscriptions", () => {
      registry.subscribe(baseSub);
      registry.subscribe({ ...baseSub, prNumber: 43, prUrl: "https://github.com/owner/repo/pull/43" });
      expect(registry.count).toBe(2);

      registry.closeAll();
      expect(registry.count).toBe(0);
    });

    it("is safe to call on empty registry", () => {
      registry.closeAll();
      expect(registry.count).toBe(0);
    });
  });
});
