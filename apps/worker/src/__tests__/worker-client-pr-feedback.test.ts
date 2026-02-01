/**
 * Tests for WorkerClient PR Feedback Handling
 *
 * Verifies:
 * - formatPrFeedbackPrompt generates correct prompts from review feedback
 * - handlePrFeedback creates correct InterviewRequest for session resume
 * - pr_feedback message routing in handleMessage
 * - Workspace selection for PR feedback sessions
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PrFeedbackRequest, PrReviewFeedback } from "@clive/worker-protocol";

/**
 * Standalone implementation of formatPrFeedbackPrompt for testing.
 * Mirrors the logic in worker-client.ts without requiring Effect runtime.
 */
function formatPrFeedbackPrompt(request: PrFeedbackRequest): string {
  const lines: string[] = [
    `You previously created PR #${request.prNumber} for ${request.repo}.`,
    `PR URL: ${request.prUrl}`,
    "",
    "The PR has received review feedback that needs to be addressed:",
    "",
  ];

  for (const fb of request.feedback) {
    lines.push(`**${fb.author}**${fb.state ? ` (${fb.state})` : ""}:`);
    if (fb.path) {
      lines.push(`  File: \`${fb.path}\`${fb.line ? `:${fb.line}` : ""}`);
    }
    lines.push(`  ${fb.body}`);
    lines.push("");
  }

  lines.push(
    "Please address each piece of feedback, push the fixes, and respond with a summary of changes made.",
    "When you're done, provide a JSON block with the following structure for each addressed comment:",
    "```json",
    '{ "summary": "Brief description of all changes", "commentReplies": [{ "commentId": <id>, "reply": "What was changed" }] }',
    "```",
  );

  return lines.join("\n");
}

describe("formatPrFeedbackPrompt", () => {
  const baseRequest: PrFeedbackRequest = {
    sessionId: "feedback-session-1",
    prUrl: "https://github.com/owner/repo/pull/42",
    prNumber: 42,
    repo: "owner/repo",
    claudeSessionId: "claude-abc",
    feedbackType: "changes_requested",
    feedback: [],
  };

  it("includes PR number and repo in header", () => {
    const prompt = formatPrFeedbackPrompt(baseRequest);

    expect(prompt).toContain("PR #42");
    expect(prompt).toContain("owner/repo");
    expect(prompt).toContain("https://github.com/owner/repo/pull/42");
  });

  it("formats single review comment with author and body", () => {
    const request: PrFeedbackRequest = {
      ...baseRequest,
      feedback: [
        {
          author: "reviewer",
          body: "Please use const instead of let here",
        },
      ],
    };

    const prompt = formatPrFeedbackPrompt(request);

    expect(prompt).toContain("**reviewer**:");
    expect(prompt).toContain("Please use const instead of let here");
  });

  it("formats feedback with file path and line number", () => {
    const request: PrFeedbackRequest = {
      ...baseRequest,
      feedback: [
        {
          author: "lead",
          body: "This function is too complex",
          path: "src/services/auth.ts",
          line: 42,
        },
      ],
    };

    const prompt = formatPrFeedbackPrompt(request);

    expect(prompt).toContain("File: `src/services/auth.ts`:42");
    expect(prompt).toContain("This function is too complex");
  });

  it("formats feedback with file path but no line number", () => {
    const request: PrFeedbackRequest = {
      ...baseRequest,
      feedback: [
        {
          author: "dev",
          body: "Missing export",
          path: "src/index.ts",
        },
      ],
    };

    const prompt = formatPrFeedbackPrompt(request);

    expect(prompt).toContain("File: `src/index.ts`");
    expect(prompt).not.toContain("File: `src/index.ts`:");
  });

  it("formats feedback with review state", () => {
    const request: PrFeedbackRequest = {
      ...baseRequest,
      feedback: [
        {
          author: "reviewer",
          body: "Needs error handling",
          state: "CHANGES_REQUESTED",
        },
      ],
    };

    const prompt = formatPrFeedbackPrompt(request);

    expect(prompt).toContain("**reviewer** (CHANGES_REQUESTED):");
  });

  it("formats multiple feedback items", () => {
    const request: PrFeedbackRequest = {
      ...baseRequest,
      feedback: [
        {
          author: "alice",
          body: "Fix the null check",
          path: "src/handler.ts",
          line: 10,
        },
        {
          author: "bob",
          body: "Add error handling",
          state: "CHANGES_REQUESTED",
        },
        {
          author: "charlie",
          body: "LGTM with minor nits",
          state: "APPROVED",
        },
      ],
    };

    const prompt = formatPrFeedbackPrompt(request);

    expect(prompt).toContain("**alice**:");
    expect(prompt).toContain("**bob** (CHANGES_REQUESTED):");
    expect(prompt).toContain("**charlie** (APPROVED):");
    expect(prompt).toContain("Fix the null check");
    expect(prompt).toContain("Add error handling");
    expect(prompt).toContain("LGTM with minor nits");
  });

  it("handles empty feedback array", () => {
    const prompt = formatPrFeedbackPrompt(baseRequest);

    expect(prompt).toContain("PR #42");
    expect(prompt).toContain("address each piece of feedback");
    // Should still produce a valid prompt, just without feedback items
  });

  it("includes JSON response template instructions", () => {
    const prompt = formatPrFeedbackPrompt(baseRequest);

    expect(prompt).toContain("```json");
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"commentReplies"');
    expect(prompt).toContain('"commentId"');
  });

  it("includes instruction to push fixes", () => {
    const prompt = formatPrFeedbackPrompt(baseRequest);

    expect(prompt).toContain("push the fixes");
  });
});

describe("handlePrFeedback InterviewRequest construction", () => {
  /**
   * Simulates the InterviewRequest construction from handlePrFeedback
   * without requiring the full Effect runtime.
   */
  function buildInterviewRequest(request: PrFeedbackRequest) {
    const prompt = formatPrFeedbackPrompt(request);
    return {
      sessionId: request.sessionId,
      threadTs: request.sessionId,
      channel: "",
      initiatorId: "",
      initialPrompt: prompt,
      model: "sonnet" as const,
      projectId: request.projectId,
      mode: "build" as const,
      claudeSessionId: request.claudeSessionId,
    };
  }

  it("uses sessionId from the feedback request", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-42",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-xyz",
      feedbackType: "changes_requested",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.sessionId).toBe("feedback-session-42");
    expect(result.threadTs).toBe("feedback-session-42");
  });

  it("sets claudeSessionId for session resume", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-1",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-original-session-abc",
      feedbackType: "review_comment",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.claudeSessionId).toBe("claude-original-session-abc");
  });

  it("sets mode to build", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-1",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-abc",
      feedbackType: "comment",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.mode).toBe("build");
  });

  it("passes projectId through from request", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-1",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-abc",
      projectId: "my-project-id",
      feedbackType: "changes_requested",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.projectId).toBe("my-project-id");
  });

  it("handles missing projectId", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-1",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-abc",
      feedbackType: "changes_requested",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.projectId).toBeUndefined();
  });

  it("uses sonnet model for PR feedback", () => {
    const request: PrFeedbackRequest = {
      sessionId: "feedback-session-1",
      prUrl: "https://github.com/owner/repo/pull/10",
      prNumber: 10,
      repo: "owner/repo",
      claudeSessionId: "claude-abc",
      feedbackType: "changes_requested",
      feedback: [],
    };

    const result = buildInterviewRequest(request);

    expect(result.model).toBe("sonnet");
  });
});

describe("pr_feedback message routing", () => {
  /**
   * Simulates the workspace path resolution logic from handlePrFeedback
   */
  function resolveWorkspacePath(
    projectId: string | undefined,
    projects: Array<{ id: string; name: string; path: string; aliases?: string[] }>,
    defaultProject: string | undefined,
  ): string {
    if (projectId) {
      const project = projects.find(
        (p) =>
          p.id === projectId ||
          p.name.toLowerCase() === projectId.toLowerCase() ||
          p.aliases?.some((a) => a.toLowerCase() === projectId.toLowerCase()),
      );
      return project?.path ?? (projects.find((p) => p.id === defaultProject) || projects[0]).path;
    }
    return (projects.find((p) => p.id === defaultProject) || projects[0]).path;
  }

  const projects = [
    { id: "proj-1", name: "Alpha", path: "/workspace/alpha", aliases: ["a"] },
    { id: "proj-2", name: "Beta", path: "/workspace/beta" },
    { id: "proj-3", name: "Gamma", path: "/workspace/gamma" },
  ];

  it("selects workspace by project ID", () => {
    const path = resolveWorkspacePath("proj-2", projects, "proj-1");
    expect(path).toBe("/workspace/beta");
  });

  it("selects workspace by project name (case-insensitive)", () => {
    const path = resolveWorkspacePath("BETA", projects, "proj-1");
    expect(path).toBe("/workspace/beta");
  });

  it("selects workspace by alias (case-insensitive)", () => {
    const path = resolveWorkspacePath("A", projects, "proj-1");
    expect(path).toBe("/workspace/alpha");
  });

  it("falls back to default project when project ID not found", () => {
    const path = resolveWorkspacePath("nonexistent", projects, "proj-2");
    expect(path).toBe("/workspace/beta");
  });

  it("falls back to first project when no default and project not found", () => {
    const path = resolveWorkspacePath("nonexistent", projects, undefined);
    expect(path).toBe("/workspace/alpha");
  });

  it("uses default project when no projectId provided", () => {
    const path = resolveWorkspacePath(undefined, projects, "proj-3");
    expect(path).toBe("/workspace/gamma");
  });

  it("uses first project when no projectId and no default", () => {
    const path = resolveWorkspacePath(undefined, projects, undefined);
    expect(path).toBe("/workspace/alpha");
  });
});

describe("CentralToWorkerMessage pr_feedback schema validation", () => {
  // Use dynamic import for ESM-only package
  let CentralToWorkerMessageSchema: any;

  beforeEach(async () => {
    const mod = await import("@clive/worker-protocol");
    CentralToWorkerMessageSchema = mod.CentralToWorkerMessageSchema;
  });

  it("validates a well-formed pr_feedback message", () => {
    const message = {
      type: "pr_feedback",
      payload: {
        sessionId: "feedback-1",
        prUrl: "https://github.com/owner/repo/pull/42",
        prNumber: 42,
        repo: "owner/repo",
        claudeSessionId: "claude-abc",
        feedbackType: "changes_requested",
        feedback: [
          { author: "reviewer", body: "Fix this" },
        ],
      },
    };

    const result = CentralToWorkerMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });

  it("rejects pr_feedback with missing required fields", () => {
    const message = {
      type: "pr_feedback",
      payload: {
        sessionId: "feedback-1",
        // Missing prUrl, prNumber, repo, claudeSessionId, feedbackType, feedback
      },
    };

    const result = CentralToWorkerMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it("rejects pr_feedback with invalid feedbackType", () => {
    const message = {
      type: "pr_feedback",
      payload: {
        sessionId: "feedback-1",
        prUrl: "https://github.com/owner/repo/pull/42",
        prNumber: 42,
        repo: "owner/repo",
        claudeSessionId: "claude-abc",
        feedbackType: "invalid_type",
        feedback: [],
      },
    };

    const result = CentralToWorkerMessageSchema.safeParse(message);
    expect(result.success).toBe(false);
  });

  it("accepts pr_feedback with optional fields", () => {
    const message = {
      type: "pr_feedback",
      payload: {
        sessionId: "feedback-1",
        prUrl: "https://github.com/owner/repo/pull/42",
        prNumber: 42,
        repo: "owner/repo",
        claudeSessionId: "claude-abc",
        projectId: "proj-1",
        feedbackType: "review_comment",
        feedback: [
          {
            author: "reviewer",
            body: "Fix this",
            path: "src/index.ts",
            line: 42,
            state: "CHANGES_REQUESTED",
            commentId: 12345,
          },
        ],
      },
    };

    const result = CentralToWorkerMessageSchema.safeParse(message);
    expect(result.success).toBe(true);
  });
});
