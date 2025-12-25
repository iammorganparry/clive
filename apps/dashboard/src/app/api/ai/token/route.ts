import { auth } from "@clive/auth";
import { getVercelOidcToken } from "@vercel/oidc";
import { Effect } from "effect";
import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "~/env.js";
import { logTokenRequest } from "~/lib/audit-log";
import { checkTokenEndpointRateLimit } from "~/lib/rate-limit";

class UnauthorizedError {
  readonly _tag = "UnauthorizedError";
  constructor(readonly message: string = "Unauthorized") {}
}

class TokenGenerationError {
  readonly _tag = "TokenGenerationError";
  constructor(readonly message: string = "Failed to generate token") {}
}

const getOidcToken = Effect.gen(function* () {
  const session = yield* Effect.promise(async () => {
    return await auth.api.getSession({
      headers: await headers(),
    });
  });

  if (!session?.user.id) {
    return yield* Effect.fail(new UnauthorizedError());
  }

  // Check for local development fallback first (only in development)
  if (env.NODE_ENV === "development" && env.AI_GATEWAY_API_KEY) {
    return { token: env.AI_GATEWAY_API_KEY };
  }

  // Otherwise use Vercel OIDC (production)
  const token = yield* Effect.promise(() => getVercelOidcToken()).pipe(
    Effect.catchAll((error: unknown) => {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return Effect.fail(new TokenGenerationError(errorMessage));
    }),
  );

  return { token };
});

export async function GET(request: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkTokenEndpointRateLimit(request);
  if (rateLimitResult.isLimited) {
    logTokenRequest(request, null, false, "Rate limit exceeded");
    return NextResponse.json(
      { error: rateLimitResult.error },
      {
        status: rateLimitResult.status,
        headers: {
          ...rateLimitResult.headers,
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  // Validate extension origin
  const extensionHeader = request.headers.get("x-clive-extension");
  const userAgent = request.headers.get("user-agent") || "";
  const isExtensionRequest =
    extensionHeader === "true" || userAgent.includes("Clive-Extension");

  if (!isExtensionRequest) {
    logTokenRequest(request, null, false, "Invalid origin");
    return NextResponse.json(
      { error: "Unauthorized: Invalid origin" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  // Get session for audit logging
  const session = await auth.api.getSession({
    headers: request.headers,
  });
  const userId = session?.user.id || null;

  const result = await Effect.runPromise(
    getOidcToken.pipe(
      Effect.catchAll((error) => {
        if (error._tag === "UnauthorizedError") {
          logTokenRequest(request, userId, false, "Unauthorized");
          return Effect.succeed({
            error: "Unauthorized",
            status: 401,
          });
        }
        if (error._tag === "TokenGenerationError") {
          logTokenRequest(request, userId, false, error.message);
          return Effect.succeed({
            error: error.message,
            status: 500,
          });
        }
        logTokenRequest(request, userId, false, "Internal server error");
        return Effect.succeed({
          error: "Internal server error",
          status: 500,
        });
      }),
    ),
  );

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      {
        status: result.status,
        headers: {
          ...rateLimitResult.headers,
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }

  logTokenRequest(request, userId, true);
  return NextResponse.json(
    { token: result.token },
    {
      headers: {
        ...rateLimitResult.headers,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
