/**
 * GitHub Service
 *
 * Wraps the GitHub REST API via @octokit/rest for bidirectional PR communication.
 * Used to comment on PRs, reply to review comments, and fetch review data.
 *
 * Authentication: GITHUB_TOKEN env var (PAT or GitHub App installation token).
 */

import { Octokit } from "@octokit/rest";

/**
 * GitHub service for PR interactions
 */
export class GitHubService {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Update the authentication token (used for GitHub App token refresh)
   */
  updateToken(token: string): void {
    this.octokit = new Octokit({ auth: token });
  }

  /**
   * Parse "owner/repo" into separate parts
   */
  private parseRepo(repo: string): { owner: string; repo: string } {
    const [owner, repoName] = repo.split("/");
    if (!owner || !repoName) {
      throw new Error(`Invalid repo format: "${repo}" (expected "owner/repo")`);
    }
    return { owner, repo: repoName };
  }

  /**
   * Post a top-level comment on a PR
   */
  async commentOnPr(repo: string, prNumber: number, body: string): Promise<void> {
    const { owner, repo: repoName } = this.parseRepo(repo);
    try {
      await this.octokit.issues.createComment({
        owner,
        repo: repoName,
        issue_number: prNumber,
        body,
      });
      console.log(`[GitHubService] Commented on ${repo}#${prNumber}`);
    } catch (error) {
      console.error(`[GitHubService] Failed to comment on ${repo}#${prNumber}:`, error);
      throw error;
    }
  }

  /**
   * Reply to an inline review comment on a PR
   */
  async replyToReviewComment(
    repo: string,
    prNumber: number,
    commentId: number,
    body: string,
  ): Promise<void> {
    const { owner, repo: repoName } = this.parseRepo(repo);
    try {
      await this.octokit.pulls.createReplyForReviewComment({
        owner,
        repo: repoName,
        pull_number: prNumber,
        comment_id: commentId,
        body,
      });
      console.log(`[GitHubService] Replied to comment ${commentId} on ${repo}#${prNumber}`);
    } catch (error) {
      console.error(
        `[GitHubService] Failed to reply to comment ${commentId} on ${repo}#${prNumber}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Fetch pending review comments on a PR
   */
  async getPrReviewComments(
    repo: string,
    prNumber: number,
  ): Promise<Array<{
    id: number;
    author: string;
    body: string;
    path: string;
    line: number | null;
    createdAt: string;
  }>> {
    const { owner, repo: repoName } = this.parseRepo(repo);
    const { data } = await this.octokit.pulls.listReviewComments({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return data.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? "unknown",
      body: comment.body,
      path: comment.path,
      line: comment.line ?? comment.original_line ?? null,
      createdAt: comment.created_at,
    }));
  }

  /**
   * Fetch review summaries for a PR
   */
  async getPrReviews(
    repo: string,
    prNumber: number,
  ): Promise<Array<{
    id: number;
    author: string;
    body: string;
    state: string;
    submittedAt: string;
  }>> {
    const { owner, repo: repoName } = this.parseRepo(repo);
    const { data } = await this.octokit.pulls.listReviews({
      owner,
      repo: repoName,
      pull_number: prNumber,
    });

    return data.map((review) => ({
      id: review.id,
      author: review.user?.login ?? "unknown",
      body: review.body ?? "",
      state: review.state,
      submittedAt: review.submitted_at ?? "",
    }));
  }
}
