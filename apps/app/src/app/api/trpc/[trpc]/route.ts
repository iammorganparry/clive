import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { auth } from "@clerk/nextjs/server";
import { appRouter, createTRPCContext } from "@clive/api";
import { env } from "~/env";
import { TRPCError } from "@trpc/server";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  const a = await auth();
  if (!a.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return createTRPCContext({
    headers: req.headers,
    auth: a,
  });
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),

    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
            );
          }
        : undefined,
  });

export { handler as GET, handler as POST };
