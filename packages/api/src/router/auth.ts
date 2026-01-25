import type { TRPCRouterRecord } from "@trpc/server";

import { protectedProcedure, publicProcedure } from "../trpc.js";

export const authRouter = {
  /**
   * @contract auth.getSession
   * @see contracts/system.md#auth.getSession
   */
  getSession: publicProcedure.query(async ({ ctx }) => {
    return {
      userId: ctx.userId,
    };
  }),
  /**
   * @contract auth.getSecretMessage
   * @see contracts/system.md#auth.getSecretMessage
   */
  getSecretMessage: protectedProcedure.query(() => {
    return "you can see this secret message!";
  }),
} satisfies TRPCRouterRecord;
