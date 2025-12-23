import { z } from "zod";

// Schema for TestCase (used in ProposedTest)
const testCaseSchema = z.object({
  name: z.string(),
  userActions: z.array(z.string()),
  assertions: z.array(z.string()),
  category: z.enum(["happy_path", "error", "edge_case", "accessibility"]),
});

// Schema for ProposedTest
const proposedTestSchema = z.object({
  id: z.string(),
  sourceFile: z.string(),
  targetTestPath: z.string(),
  description: z.string(),
  isUpdate: z.boolean(),
  proposedContent: z.string(),
  existingContent: z.string().optional(),
  navigationPath: z.string().optional(),
  pageContext: z.string().optional(),
  prerequisites: z.array(z.string()).optional(),
  relatedTests: z.array(z.string()).optional(),
  userFlow: z.string().optional(),
  testCases: z.array(testCaseSchema).optional(),
});

// Schema for proposal events from planTests subscription
export const proposalEventSchema = z.object({
  type: z.literal("proposal"),
  test: proposedTestSchema,
  toolCallId: z.string(),
  subscriptionId: z.string(),
});

export const progressEventSchema = z.object({
  type: z.literal("progress"),
  status: z.string(),
  message: z.string(),
});

export const planFileCreatedEventSchema = z.object({
  type: z.literal("plan_file_created"),
  planFilePath: z.string(),
  proposalId: z.string(),
  subscriptionId: z.string(),
});

export const contentStreamedEventSchema = z.object({
  type: z.literal("content_streamed"),
  content: z.string(),
});

export const subscriptionEventSchema = z.discriminatedUnion("type", [
  proposalEventSchema,
  progressEventSchema,
  planFileCreatedEventSchema,
  contentStreamedEventSchema,
]);

export const subscriptionCompleteSchema = z.object({
  proposals: z.array(proposedTestSchema).optional(),
  executions: z
    .array(
      z.object({
        testId: z.string(),
        filePath: z.string().optional(),
      }),
    )
    .optional(),
});

// Type exports
export type ProposalEvent = z.infer<typeof proposalEventSchema>;
export type ProgressEvent = z.infer<typeof progressEventSchema>;
export type PlanFileCreatedEvent = z.infer<typeof planFileCreatedEventSchema>;
export type ContentStreamedEvent = z.infer<typeof contentStreamedEventSchema>;
export type SubscriptionEvent = z.infer<typeof subscriptionEventSchema>;
export type SubscriptionComplete = z.infer<typeof subscriptionCompleteSchema>;

// Type guards
export function isProposalEvent(data: unknown): data is ProposalEvent {
  return proposalEventSchema.safeParse(data).success;
}

export function isProgressEvent(data: unknown): data is ProgressEvent {
  return progressEventSchema.safeParse(data).success;
}

export function isPlanFileCreatedEvent(
  data: unknown,
): data is PlanFileCreatedEvent {
  return planFileCreatedEventSchema.safeParse(data).success;
}

export function isContentStreamedEvent(
  data: unknown,
): data is ContentStreamedEvent {
  return contentStreamedEventSchema.safeParse(data).success;
}

export function isSubscriptionComplete(
  data: unknown,
): data is SubscriptionComplete {
  return subscriptionCompleteSchema.safeParse(data).success;
}
