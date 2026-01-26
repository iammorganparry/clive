/**
 * Tests for Worker Protocol Schemas
 *
 * Verifies Zod schemas for session resume functionality.
 */

import { describe, expect, it } from "vitest";
import {
  InterviewEventPayloadSchema,
  InterviewEventSchema,
  InterviewRequestSchema,
} from "../schemas";

describe("Worker Protocol Schemas", () => {
  describe("InterviewRequestSchema", () => {
    it("validates request without claudeSessionId", () => {
      const request = {
        sessionId: "session-123",
        threadTs: "1234567890.123456",
        channel: "C12345678",
        initiatorId: "U12345678",
        initialPrompt: "Build a feature",
        model: "opus",
        mode: "plan",
      };

      const result = InterviewRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claudeSessionId).toBeUndefined();
      }
    });

    it("validates request with claudeSessionId for resume", () => {
      const request = {
        sessionId: "session-123",
        threadTs: "1234567890.123456",
        channel: "C12345678",
        initiatorId: "U12345678",
        initialPrompt: "Continue the conversation",
        model: "opus",
        mode: "plan",
        claudeSessionId: "abc123-def456-ghi789",
      };

      const result = InterviewRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.claudeSessionId).toBe("abc123-def456-ghi789");
      }
    });

    it("allows claudeSessionId to be undefined", () => {
      const request = {
        sessionId: "session-123",
        threadTs: "1234567890.123456",
        channel: "C12345678",
        initiatorId: "U12345678",
        initialPrompt: "Build a feature",
        claudeSessionId: undefined,
      };

      const result = InterviewRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
  });

  describe("InterviewEventPayloadSchema", () => {
    it("validates session_started event", () => {
      const payload = {
        type: "session_started",
        claudeSessionId: "abc123-def456-ghi789",
      };

      const result = InterviewEventPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("session_started");
        if (result.data.type === "session_started") {
          expect(result.data.claudeSessionId).toBe("abc123-def456-ghi789");
        }
      }
    });

    it("requires claudeSessionId for session_started event", () => {
      const payload = {
        type: "session_started",
        // Missing claudeSessionId
      };

      const result = InterviewEventPayloadSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("validates question event", () => {
      const payload = {
        type: "question",
        data: {
          toolUseID: "tool-123",
          questions: [
            {
              header: "Project",
              question: "What project are you working on?",
              options: [
                { label: "Option 1", description: "Description 1" },
              ],
              multiSelect: false,
            },
          ],
        },
      };

      const result = InterviewEventPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("validates complete event", () => {
      const payload = {
        type: "complete",
      };

      const result = InterviewEventPayloadSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });
  });

  describe("InterviewEventSchema", () => {
    it("validates session_started event with full structure", () => {
      const event = {
        sessionId: "session-123",
        type: "session_started",
        payload: {
          type: "session_started",
          claudeSessionId: "abc123-def456-ghi789",
        },
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      const result = InterviewEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("validates complete event with full structure", () => {
      const event = {
        sessionId: "session-123",
        type: "complete",
        payload: {
          type: "complete",
        },
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      const result = InterviewEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });
});
