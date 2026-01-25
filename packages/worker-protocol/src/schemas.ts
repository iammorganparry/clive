/**
 * Worker Protocol Schemas
 *
 * Zod validation schemas for all protocol types.
 * Used for runtime validation of messages.
 */

import { z } from "zod";

// ============================================================
// Base Schemas
// ============================================================

export const WorkerStatusSchema = z.enum([
  "connecting",
  "ready",
  "busy",
  "disconnected",
]);

export const InterviewPhaseSchema = z.enum([
  "starting",
  "problem",
  "scope",
  "technical",
  "confirmation",
  "researching",
  "generating",
  "reviewing",
  "creating_issues",
  "completed",
  "timed_out",
  "error",
]);

export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});

export const QuestionSchema = z.object({
  header: z.string(),
  question: z.string(),
  options: z.array(QuestionOptionSchema),
  multiSelect: z.boolean(),
});

export const QuestionDataSchema = z.object({
  toolUseID: z.string(),
  questions: z.array(QuestionSchema),
});

// ============================================================
// Worker Registration
// ============================================================

export const NgrokConfigSchema = z.object({
  authtoken: z.string(),
  domain: z.string().optional(),
  region: z.string().optional(),
});

export const WorkerProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  aliases: z.array(z.string()).optional(),
  description: z.string().optional(),
});

export const WorkerRegistrationSchema = z.object({
  workerId: z.string(),
  apiToken: z.string(),
  projects: z.array(WorkerProjectSchema),
  defaultProject: z.string().optional(),
  hostname: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const WorkerRegistrationResponseSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  workerId: z.string(),
  websocketUrl: z.string(),
  ngrokConfig: NgrokConfigSchema.optional(),
});

export const WorkerHeartbeatSchema = z.object({
  workerId: z.string(),
  status: WorkerStatusSchema,
  activeSessions: z.array(z.string()),
  stats: z
    .object({
      cpuUsage: z.number(),
      memoryUsage: z.number(),
      uptime: z.number(),
    })
    .optional(),
});

// ============================================================
// Interview Messages
// ============================================================

export const InterviewRequestSchema = z.object({
  sessionId: z.string(),
  threadTs: z.string(),
  channel: z.string(),
  initiatorId: z.string(),
  initialPrompt: z.string(),
  model: z.string().optional(),
  /** Target project ID for routing */
  projectId: z.string().optional(),
});

export const InterviewEventPayloadSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("question"), data: QuestionDataSchema }),
  z.object({ type: z.literal("phase_change"), phase: InterviewPhaseSchema }),
  z.object({ type: z.literal("text"), content: z.string() }),
  z.object({ type: z.literal("plan_ready"), content: z.string() }),
  z.object({ type: z.literal("issues_created"), urls: z.array(z.string()) }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("timeout") }),
  z.object({ type: z.literal("complete") }),
]);

export const InterviewEventSchema = z.object({
  sessionId: z.string(),
  type: z.enum([
    "question",
    "phase_change",
    "text",
    "plan_ready",
    "issues_created",
    "error",
    "timeout",
    "complete",
  ]),
  payload: InterviewEventPayloadSchema,
  timestamp: z.string(),
});

export const AnswerRequestSchema = z.object({
  sessionId: z.string(),
  toolUseId: z.string(),
  answers: z.record(z.string(), z.string()),
});

export const MessageRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

export const CancelRequestSchema = z.object({
  sessionId: z.string(),
  reason: z.string().optional(),
});

// ============================================================
// WebSocket Message Schemas
// ============================================================

export const CentralToWorkerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("start_interview"),
    payload: InterviewRequestSchema,
  }),
  z.object({ type: z.literal("answer"), payload: AnswerRequestSchema }),
  z.object({ type: z.literal("message"), payload: MessageRequestSchema }),
  z.object({ type: z.literal("cancel"), payload: CancelRequestSchema }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("config_update"),
    payload: z.object({ ngrokConfig: NgrokConfigSchema.optional() }),
  }),
]);

export const WorkerToCentralMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("register"), payload: WorkerRegistrationSchema }),
  z.object({ type: z.literal("heartbeat"), payload: WorkerHeartbeatSchema }),
  z.object({ type: z.literal("event"), payload: InterviewEventSchema }),
  z.object({ type: z.literal("pong") }),
  z.object({
    type: z.literal("error"),
    payload: z.object({
      message: z.string(),
      sessionId: z.string().optional(),
    }),
  }),
]);

// ============================================================
// HTTP API Schemas
// ============================================================

export const RegisterWorkerRequestSchema = z.object({
  apiToken: z.string(),
  projects: z.array(WorkerProjectSchema),
  defaultProject: z.string().optional(),
  hostname: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

export const RegisterWorkerResponseSchema = z.object({
  success: z.boolean(),
  workerId: z.string().optional(),
  websocketUrl: z.string().optional(),
  ngrokConfig: NgrokConfigSchema.optional(),
  error: z.string().optional(),
});

export const WorkerInfoSchema = z.object({
  workerId: z.string(),
  status: WorkerStatusSchema,
  hostname: z.string().optional(),
  activeSessions: z.number(),
  lastHeartbeat: z.string(),
  connectedAt: z.string(),
});

export const ListWorkersResponseSchema = z.object({
  workers: z.array(WorkerInfoSchema),
});

export const SessionInfoSchema = z.object({
  sessionId: z.string(),
  workerId: z.string(),
  channel: z.string(),
  initiatorId: z.string(),
  phase: InterviewPhaseSchema,
  createdAt: z.string(),
  lastActivityAt: z.string(),
});
