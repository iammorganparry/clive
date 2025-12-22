import { Effect } from "effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { auth } from "@clive/auth";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { env } from "~/env.js";

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

  // Check for local development fallback first
  if (env.AI_GATEWAY_API_KEY) {
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

export async function GET() {
  const result = await Effect.runPromise(
    getOidcToken.pipe(
      Effect.catchAll((error) => {
        if (error._tag === "UnauthorizedError") {
          return Effect.succeed({
            error: "Unauthorized",
            status: 401,
          });
        }
        if (error._tag === "TokenGenerationError") {
          return Effect.succeed({
            error: error.message,
            status: 500,
          });
        }
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
      { status: result.status },
    );
  }

  return NextResponse.json({ token: result.token });
}
