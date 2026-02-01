/**
 * Tests for GitHubService
 *
 * Verifies PR commenting, review reply, and data fetching
 * with mocked Octokit client.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock @octokit/rest before importing GitHubService
const mockCreateComment = vi.fn();
const mockCreateReplyForReviewComment = vi.fn();
const mockListReviewComments = vi.fn();
const mockListReviews = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      issues: {
        createComment: mockCreateComment,
      },
      pulls: {
        createReplyForReviewComment: mockCreateReplyForReviewComment,
        listReviewComments: mockListReviewComments,
        listReviews: mockListReviews,
      },
    };
  }),
}));

import { GitHubService } from "../github-service";

describe("GitHubService", () => {
  let service: GitHubService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new GitHubService("test-token");
  });

  afterEach(() => {
    // Don't use restoreAllMocks() here — it would undo the Octokit mockImplementation
    // set up by vi.mock at module level, breaking subsequent tests.
  });

  describe("commentOnPr", () => {
    it("posts a comment to the correct repo and PR", async () => {
      mockCreateComment.mockResolvedValue({ data: { id: 1 } });

      await service.commentOnPr("owner/repo", 42, "Test comment");

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        issue_number: 42,
        body: "Test comment",
      });
    });

    it("handles multi-segment owner names", async () => {
      mockCreateComment.mockResolvedValue({ data: { id: 1 } });

      await service.commentOnPr("my-org/my-repo", 7, "Hello");

      expect(mockCreateComment).toHaveBeenCalledWith({
        owner: "my-org",
        repo: "my-repo",
        issue_number: 7,
        body: "Hello",
      });
    });

    it("throws on invalid repo format", async () => {
      await expect(service.commentOnPr("invalid", 42, "test")).rejects.toThrow(
        'Invalid repo format: "invalid" (expected "owner/repo")',
      );
    });

    it("throws on empty repo string", async () => {
      await expect(service.commentOnPr("", 42, "test")).rejects.toThrow(
        'Invalid repo format',
      );
    });

    it("propagates API errors", async () => {
      mockCreateComment.mockRejectedValue(new Error("API rate limit"));

      await expect(
        service.commentOnPr("owner/repo", 42, "test"),
      ).rejects.toThrow("API rate limit");
    });
  });

  describe("replyToReviewComment", () => {
    it("replies to a specific review comment", async () => {
      mockCreateReplyForReviewComment.mockResolvedValue({ data: { id: 2 } });

      await service.replyToReviewComment("owner/repo", 42, 100, "Fixed this");

      expect(mockCreateReplyForReviewComment).toHaveBeenCalledWith({
        owner: "owner",
        repo: "repo",
        pull_number: 42,
        comment_id: 100,
        body: "Fixed this",
      });
    });

    it("propagates API errors", async () => {
      mockCreateReplyForReviewComment.mockRejectedValue(new Error("Not found"));

      await expect(
        service.replyToReviewComment("owner/repo", 42, 999, "test"),
      ).rejects.toThrow("Not found");
    });

    it("throws on invalid repo format", async () => {
      await expect(
        service.replyToReviewComment("bad", 42, 100, "test"),
      ).rejects.toThrow("Invalid repo format");
    });
  });

  describe("getPrReviewComments", () => {
    it("returns formatted review comments", async () => {
      mockListReviewComments.mockResolvedValue({
        data: [
          {
            id: 101,
            user: { login: "reviewer" },
            body: "Please fix this",
            path: "src/index.ts",
            line: 42,
            original_line: null,
            created_at: "2024-01-01T00:00:00Z",
          },
          {
            id: 102,
            user: null,
            body: "Another comment",
            path: "README.md",
            line: null,
            original_line: 10,
            created_at: "2024-01-02T00:00:00Z",
          },
        ],
      });

      const comments = await service.getPrReviewComments("owner/repo", 42);

      expect(comments).toHaveLength(2);
      expect(comments[0]).toEqual({
        id: 101,
        author: "reviewer",
        body: "Please fix this",
        path: "src/index.ts",
        line: 42,
        createdAt: "2024-01-01T00:00:00Z",
      });
      expect(comments[1]).toEqual({
        id: 102,
        author: "unknown",
        body: "Another comment",
        path: "README.md",
        line: 10,
        createdAt: "2024-01-02T00:00:00Z",
      });
    });

    it("returns empty array when no comments", async () => {
      mockListReviewComments.mockResolvedValue({ data: [] });
      const comments = await service.getPrReviewComments("owner/repo", 42);
      expect(comments).toEqual([]);
    });

    it("handles comments with no line info", async () => {
      mockListReviewComments.mockResolvedValue({
        data: [
          {
            id: 103,
            user: { login: "dev" },
            body: "General comment",
            path: "file.ts",
            line: null,
            original_line: null,
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const comments = await service.getPrReviewComments("owner/repo", 42);
      expect(comments[0].line).toBeNull();
    });
  });

  describe("getPrReviews", () => {
    it("returns formatted review summaries", async () => {
      mockListReviews.mockResolvedValue({
        data: [
          {
            id: 201,
            user: { login: "lead" },
            body: "LGTM with minor nits",
            state: "CHANGES_REQUESTED",
            submitted_at: "2024-01-01T12:00:00Z",
          },
          {
            id: 202,
            user: { login: "peer" },
            body: null,
            state: "APPROVED",
            submitted_at: null,
          },
        ],
      });

      const reviews = await service.getPrReviews("owner/repo", 42);

      expect(reviews).toHaveLength(2);
      expect(reviews[0]).toEqual({
        id: 201,
        author: "lead",
        body: "LGTM with minor nits",
        state: "CHANGES_REQUESTED",
        submittedAt: "2024-01-01T12:00:00Z",
      });
      expect(reviews[1]).toEqual({
        id: 202,
        author: "peer",
        body: "",
        state: "APPROVED",
        submittedAt: "",
      });
    });

    it("returns empty array when no reviews", async () => {
      mockListReviews.mockResolvedValue({ data: [] });
      const reviews = await service.getPrReviews("owner/repo", 42);
      expect(reviews).toEqual([]);
    });

    it("handles reviews with missing user", async () => {
      mockListReviews.mockResolvedValue({
        data: [
          {
            id: 203,
            user: null,
            body: "Bot review",
            state: "COMMENTED",
            submitted_at: "2024-01-01T00:00:00Z",
          },
        ],
      });

      const reviews = await service.getPrReviews("owner/repo", 42);
      expect(reviews[0].author).toBe("unknown");
    });
  });
});
