import { Effect } from "effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

class UnauthorizedError {
  readonly _tag = "UnauthorizedError";
  constructor(readonly message: string = "Unauthorized") {}
}

class TokenGenerationError {
  readonly _tag = "TokenGenerationError";
  constructor(readonly message: string = "Failed to generate token") {}
}

const getOidcToken = Effect.gen(function* () {
  const authResult = yield* Effect.promise(() => auth());

  if (!authResult.userId) {
    return yield* Effect.fail(new UnauthorizedError());
  }

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
