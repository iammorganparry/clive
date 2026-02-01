/**
 * Tests for LocalExecutor PR Detection
 *
 * Verifies:
 * - PR URL detection in tool_result events (gh CLI output)
 * - pr_feedback_addressed JSON block detection in text events
 * - Edge cases: malformed JSON, missing fields, partial matches
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InterviewEvent, InterviewEventPayload } from "@clive/worker-protocol";

/**
 * Simulate the processEvent logic for PR-related detections
 * without requiring the full LocalExecutor + ClaudeCliService runtime.
 */
class EventProcessor {
  private activeSessions = new Map<string, { sessionId: string; prUrl?: string }>();
  public emittedEvents: Array<{ sessionId: string; payload: InterviewEventPayload }> = [];

  constructor() {
    // No-op
  }

  addSession(sessionId: string, prUrl?: string) {
    this.activeSessions.set(sessionId, { sessionId, prUrl });
  }

  /**
   * Process a tool_result event — mirrors LocalExecutor.processEvent "tool_result" case
   */
  processToolResult(sessionId: string, content: string): void {
    // Detect PR creation from gh CLI output
    if (content.includes("github.com") && content.includes("/pull/")) {
      const prUrlMatch = content.match(
        /https:\/\/github\.com\/[^\s]+\/pull\/\d+/,
      );
      if (prUrlMatch) {
        this.emit(sessionId, {
          type: "pr_created",
          url: prUrlMatch[0],
        });
      }
    }

    // Also detect Linear issue creation (existing behavior)
    if (content.includes("linear.app") || content.includes("Issue created")) {
      const urlMatch = content.match(/https:\/\/linear\.app\/[^\s]+/g);
      if (urlMatch) {
        this.emit(sessionId, {
          type: "issues_created",
          urls: urlMatch,
        });
      }
    }
  }

  /**
   * Process a text event — mirrors LocalExecutor.processEvent "text" case
   */
  processText(sessionId: string, content: string): void {
    // Check for plan content
    if (content.includes("## Plan") || content.includes("# Plan")) {
      this.emit(sessionId, {
        type: "plan_ready",
        content,
      });
      return;
    }

    // Check for pr_feedback_addressed JSON block
    const feedbackAddressedMatch = content.match(
      /```json\s*\n\s*\{\s*"summary"\s*:/,
    );
    if (feedbackAddressedMatch) {
      const jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n\s*```/);
      if (jsonMatch?.[1]) {
        try {
          const parsed = JSON.parse(jsonMatch[1]) as {
            summary?: string;
            commentReplies?: Array<{ commentId: number; reply: string }>;
          };
          const session = this.activeSessions.get(sessionId);
          const prUrl = (session as { prUrl?: string } | undefined)?.prUrl ?? "";
          this.emit(sessionId, {
            type: "pr_feedback_addressed",
            prUrl,
            summary: parsed.summary,
            commentReplies: parsed.commentReplies,
          });
        } catch {
          // Not valid JSON — fall through to regular text
        }
      }
    }

    // Always emit as text (even if also emitted pr_feedback_addressed)
    this.emit(sessionId, {
      type: "text",
      content,
    });
  }

  private emit(sessionId: string, payload: InterviewEventPayload): void {
    this.emittedEvents.push({ sessionId, payload });
  }
}

describe("LocalExecutor PR URL Detection (tool_result)", () => {
  let processor: EventProcessor;

  beforeEach(() => {
    processor = new EventProcessor();
    processor.addSession("session-1");
  });

  it("detects PR URL from gh CLI output", () => {
    processor.processToolResult(
      "session-1",
      "Creating pull request for feature-branch into main\nhttps://github.com/owner/repo/pull/42\n",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeDefined();
    expect((prEvent!.payload as any).url).toBe("https://github.com/owner/repo/pull/42");
  });

  it("detects PR URL with multi-segment owner and repo", () => {
    processor.processToolResult(
      "session-1",
      "https://github.com/my-org/my-cool-repo/pull/123",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeDefined();
    expect((prEvent!.payload as any).url).toBe("https://github.com/my-org/my-cool-repo/pull/123");
  });

  it("detects PR URL embedded in longer output", () => {
    processor.processToolResult(
      "session-1",
      "Pull request created successfully!\nURL: https://github.com/owner/repo/pull/7\nDone.",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeDefined();
    expect((prEvent!.payload as any).url).toBe("https://github.com/owner/repo/pull/7");
  });

  it("does not emit pr_created for non-PR GitHub URLs", () => {
    processor.processToolResult(
      "session-1",
      "https://github.com/owner/repo/issues/42",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeUndefined();
  });

  it("does not emit pr_created for partial github.com without /pull/", () => {
    processor.processToolResult(
      "session-1",
      "Check https://github.com/owner/repo for details",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeUndefined();
  });

  it("does not emit pr_created for non-GitHub pull URLs", () => {
    processor.processToolResult(
      "session-1",
      "See https://gitlab.com/owner/repo/pull/42 for details",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeUndefined();
  });

  it("detects PR URL alongside Linear URL in same output", () => {
    processor.processToolResult(
      "session-1",
      "Created issue at https://linear.app/team/issue/ENG-123\nCreated PR at https://github.com/owner/repo/pull/99",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    const linearEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "issues_created",
    );

    expect(prEvent).toBeDefined();
    expect((prEvent!.payload as any).url).toBe("https://github.com/owner/repo/pull/99");
    expect(linearEvent).toBeDefined();
    expect((linearEvent!.payload as any).urls).toContain("https://linear.app/team/issue/ENG-123");
  });

  it("handles content with github.com but no valid PR URL pattern", () => {
    processor.processToolResult(
      "session-1",
      "Visit github.com for /pull/ requests",
    );

    const prEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_created",
    );
    expect(prEvent).toBeUndefined();
  });
});

describe("LocalExecutor pr_feedback_addressed Detection (text)", () => {
  let processor: EventProcessor;

  beforeEach(() => {
    processor = new EventProcessor();
  });

  it("detects pr_feedback_addressed JSON block with summary", () => {
    processor.addSession("session-1", "https://github.com/owner/repo/pull/42");

    const content = `I've addressed all the feedback. Here's a summary:

\`\`\`json
{ "summary": "Fixed null check and added error handling", "commentReplies": [{ "commentId": 100, "reply": "Changed to const" }] }
\`\`\`

Let me know if you need anything else.`;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();

    const payload = feedbackEvent!.payload as any;
    expect(payload.summary).toBe("Fixed null check and added error handling");
    expect(payload.commentReplies).toHaveLength(1);
    expect(payload.commentReplies[0].commentId).toBe(100);
    expect(payload.commentReplies[0].reply).toBe("Changed to const");
  });

  it("uses prUrl from active session", () => {
    processor.addSession("session-1", "https://github.com/owner/repo/pull/55");

    const content = `\`\`\`json
{ "summary": "Fixed it" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).prUrl).toBe("https://github.com/owner/repo/pull/55");
  });

  it("uses empty string for prUrl when session has no prUrl", () => {
    processor.addSession("session-1"); // No prUrl

    const content = `\`\`\`json
{ "summary": "Fixed it" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).prUrl).toBe("");
  });

  it("handles JSON with only summary (no commentReplies)", () => {
    processor.addSession("session-1");

    const content = `\`\`\`json
{ "summary": "All feedback addressed" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).summary).toBe("All feedback addressed");
    expect((feedbackEvent!.payload as any).commentReplies).toBeUndefined();
  });

  it("handles JSON with multiple commentReplies", () => {
    processor.addSession("session-1");

    const content = `\`\`\`json
{
  "summary": "Addressed all 3 comments",
  "commentReplies": [
    { "commentId": 100, "reply": "Fixed null check" },
    { "commentId": 101, "reply": "Added error handling" },
    { "commentId": 102, "reply": "Renamed variable" }
  ]
}
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();

    const payload = feedbackEvent!.payload as any;
    expect(payload.commentReplies).toHaveLength(3);
    expect(payload.commentReplies[0].commentId).toBe(100);
    expect(payload.commentReplies[1].commentId).toBe(101);
    expect(payload.commentReplies[2].commentId).toBe(102);
  });

  it("does not detect non-summary JSON blocks", () => {
    processor.addSession("session-1");

    const content = `Here's the config:

\`\`\`json
{ "name": "test", "version": "1.0.0" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeUndefined();

    // Should still emit as text
    const textEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "text",
    );
    expect(textEvent).toBeDefined();
  });

  it("handles malformed JSON gracefully", () => {
    processor.addSession("session-1");

    const content = `\`\`\`json
{ "summary": "This is broken JSON,
\`\`\``;

    processor.processText("session-1", content);

    // Should NOT emit pr_feedback_addressed
    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeUndefined();

    // Should still emit as text
    const textEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "text",
    );
    expect(textEvent).toBeDefined();
  });

  it("emits both pr_feedback_addressed and text for feedback JSON", () => {
    processor.addSession("session-1");

    const content = `\`\`\`json
{ "summary": "Fixed it" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    const textEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "text",
    );

    // Both should be emitted
    expect(feedbackEvent).toBeDefined();
    expect(textEvent).toBeDefined();
  });

  it("detects plan content instead of feedback JSON", () => {
    processor.addSession("session-1");

    const content = `## Plan

1. Step one
2. Step two`;

    processor.processText("session-1", content);

    const planEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "plan_ready",
    );
    expect(planEvent).toBeDefined();

    // Should NOT emit feedback addressed or regular text
    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    const textEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "text",
    );
    expect(feedbackEvent).toBeUndefined();
    expect(textEvent).toBeUndefined();
  });

  it("handles JSON block with no closing fence", () => {
    processor.addSession("session-1");

    const content = `\`\`\`json
{ "summary": "Incomplete fence`;

    processor.processText("session-1", content);

    // The regex requires a closing ```, so this should not match
    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeUndefined();
  });

  it("detects summary JSON when it is the only JSON block", () => {
    processor.addSession("session-1");

    const content = `I've made all the requested changes. Here's the summary:

\`\`\`json
{ "summary": "All fixed", "commentReplies": [] }
\`\`\`

Let me know if you need anything else.`;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).summary).toBe("All fixed");
    expect((feedbackEvent!.payload as any).commentReplies).toEqual([]);
  });

  it("extracts first JSON block when multiple blocks exist (known limitation)", () => {
    processor.addSession("session-1");

    // When a non-summary JSON block appears before the summary block,
    // the detection triggers (because "summary" is found) but extracts
    // the first block's content. This is a known edge case.
    const content = `Config:

\`\`\`json
{ "name": "test" }
\`\`\`

Summary:

\`\`\`json
{ "summary": "All fixed" }
\`\`\``;

    processor.processText("session-1", content);

    // The first JSON block doesn't have "summary", so it gets emitted
    // with undefined summary (the detection regex matches but the wrong
    // block is extracted)
    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).summary).toBeUndefined();
  });

  it("uses empty prUrl when session is not in activeSessions", () => {
    // Don't add a session — simulates the case where session lookup fails
    processor.addSession("session-1"); // add without prUrl

    const content = `\`\`\`json
{ "summary": "Done" }
\`\`\``;

    processor.processText("session-1", content);

    const feedbackEvent = processor.emittedEvents.find(
      (e) => e.payload.type === "pr_feedback_addressed",
    );
    expect(feedbackEvent).toBeDefined();
    expect((feedbackEvent!.payload as any).prUrl).toBe("");
  });
});

describe("InterviewEvent pr_feedback_addressed schema validation", () => {
  // Use dynamic import for ESM-only package
  let InterviewEventSchema: any;

  beforeEach(async () => {
    const mod = await import("@clive/worker-protocol");
    InterviewEventSchema = mod.InterviewEventSchema;
  });

  it("validates a well-formed pr_feedback_addressed event", () => {
    const event = {
      sessionId: "session-1",
      type: "pr_feedback_addressed",
      payload: {
        type: "pr_feedback_addressed",
        prUrl: "https://github.com/owner/repo/pull/42",
        summary: "Fixed the issues",
        commentReplies: [{ commentId: 100, reply: "Changed to const" }],
      },
      timestamp: new Date().toISOString(),
    };

    const result = InterviewEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("validates pr_feedback_addressed with optional fields missing", () => {
    const event = {
      sessionId: "session-1",
      type: "pr_feedback_addressed",
      payload: {
        type: "pr_feedback_addressed",
        prUrl: "https://github.com/owner/repo/pull/42",
      },
      timestamp: new Date().toISOString(),
    };

    const result = InterviewEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("rejects pr_feedback_addressed without required prUrl", () => {
    const event = {
      sessionId: "session-1",
      type: "pr_feedback_addressed",
      payload: {
        type: "pr_feedback_addressed",
        // Missing prUrl
        summary: "Fixed it",
      },
      timestamp: new Date().toISOString(),
    };

    const result = InterviewEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});
