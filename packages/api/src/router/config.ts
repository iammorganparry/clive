import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure } from "../trpc";

export const configRouter = {
  getApiKeys: protectedProcedure.query(async () => {
    // Return your application's API keys
    // These are fetched from environment variables on the server
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    };
  }),
} satisfies TRPCRouterRecord;
