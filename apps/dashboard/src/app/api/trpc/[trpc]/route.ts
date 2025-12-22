import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";

import { auth } from "@clive/auth";
import { appRouter, createTRPCContext } from "@clive/api";
import { env } from "~/env";
import { TRPCError } from "@trpc/server";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  // Debug: Log auth header presence
  const authHeader = req.headers.get("authorization");
  if (env.NODE_ENV === "development") {
    console.log(
      `[tRPC Auth] Authorization header: ${authHeader ? `Bearer ...${authHeader.slice(-20)}` : "none"}`,
    );
  }

  const session = await auth.api.getSession({
    headers: req.headers,
  });

  // Debug: Log session result
  if (env.NODE_ENV === "development") {
    console.log(
      `[tRPC Auth] Session result: ${session?.user?.id ? `user=${session.user.id}` : "null"}`,
    );
  }

  if (!session?.user.id) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return createTRPCContext({
    headers: req.headers,
    session,
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
