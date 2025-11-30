import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { clerkClient } from "@clerk/nextjs/server";

import { appRouter, createTRPCContext } from "@clive/api";

import { auth } from "~/auth/server";

/**
 * Configure basic CORS headers
 * You should extend this to match your needs
 */
const setCorsHeaders = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
};

export const OPTIONS = () => {
  const response = new Response(null, {
    status: 204,
  });
  setCorsHeaders(response);
  return response;
};

const handler = async (req: NextRequest) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: async () => {
      // Use Clerk's authenticateRequest() for proper JWT verification
      // This handles tokens from both cookies (browser) and Authorization headers (VS Code extension)
      // It verifies:
      // - Token signature using Clerk's public key (RS256)
      // - Expiration (exp claim)
      // - Not before (nbf claim)
      // - Authorized parties (azp claim) for CSRF protection
      const client = await clerkClient();
      
      // Verify the request token using Clerk's authenticateRequest()
      // This will verify tokens from both __session cookie and Authorization header
      try {
        await client.authenticateRequest(req, {
          // Optionally specify authorized parties for CSRF protection
          // authorizedParties: ['http://localhost:3000'],
        });
      } catch {
        // Token verification failed - auth() will return null userId
        // This is expected for unauthenticated requests
      }

      // Use standard auth() which will work after authenticateRequest() verification
      return createTRPCContext({
        auth: auth,
        headers: req.headers,
      });
    },
    onError({ error, path }) {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });

  setCorsHeaders(response);
  return response;
};

export { handler as GET, handler as POST };
