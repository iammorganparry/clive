import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure, publicProcedure } from "../trpc";

export const authRouter = {
  getSession: publicProcedure.query(async ({ ctx }) => {
    return {
      userId: ctx.userId,
    };
  }),
  getSecretMessage: protectedProcedure.query(() => {
    return "you can see this secret message!";
  }),
  getExtensionToken: protectedProcedure.query(async ({ ctx }) => {
    // Get the Clerk session token (JWT)
    const token = await ctx.auth.getToken();

    if (!token) {
      throw new Error("Failed to generate token");
    }

    return { token };
  }),
} satisfies TRPCRouterRecord;
