import { Data, Effect } from "effect";
import type { TrpcClient } from "../services/trpc-client-service.js";

export class ApiError extends Data.TaggedError("ApiError")<{
  message: string;
  status?: number;
  cause?: unknown;
}> {}

export class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string;
  cause?: unknown;
}> {}

export class AuthTokenMissingError extends Data.TaggedError(
  "AuthTokenMissingError",
)<{
  message: string;
}> {}

/**
 * Helper to wrap tRPC client calls in Effect with proper error handling
 */
export const wrapTrpcCall =
  <T>(
    fn: (client: TrpcClient) => Promise<T>,
  ): ((client: TrpcClient) => Effect.Effect<T, ApiError, never>) =>
  (client) =>
    Effect.tryPromise({
      try: () => fn(client),
      catch: (error) =>
        new ApiError({
          message: error instanceof Error ? error.message : "Unknown error",
          cause: error,
        }),
    });
