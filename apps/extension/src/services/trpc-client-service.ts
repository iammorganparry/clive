import { Effect } from "effect";
import { createTRPCClient, httpLink } from "@trpc/client";
import SuperJSON from "superjson";
import type { AppRouter } from "@clive/api";
import { ConfigService } from "./config-service.js";
import {
  ApiError,
  NetworkError,
  AuthTokenMissingError,
} from "../utils/trpc-utils.js";

/**
 * Create a type-safe tRPC client with auth token
 */
const createTypedClient = (authToken: string) =>
  createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: "http://localhost:3000/api/trpc",
        transformer: SuperJSON,
        headers: () => ({
          Authorization: `Bearer ${authToken}`,
        }),
      }),
    ],
  });

/**
 * Type for the tRPC client
 */
export type TrpcClient = ReturnType<typeof createTypedClient>;

/**
 * TrpcClientService - provides type-safe tRPC client access
 * Uses Effect.Service pattern for dependency injection
 */
export class TrpcClientService extends Effect.Service<TrpcClientService>()(
  "TrpcClientService",
  {
    effect: Effect.gen(function* () {
      const configService = yield* ConfigService;

      const getAuthToken = () =>
        Effect.gen(function* () {
          const token = yield* configService.getAuthToken().pipe(
            Effect.catchAll(() =>
              Effect.fail(
                new AuthTokenMissingError({
                  message: "Failed to retrieve auth token. Please log in.",
                }),
              ),
            ),
          );
          if (!token) {
            return yield* Effect.fail(
              new AuthTokenMissingError({
                message: "Auth token not available. Please log in.",
              }),
            );
          }
          return token;
        });

      const getClient = () =>
        Effect.gen(function* () {
          const authToken = yield* getAuthToken();
          return createTypedClient(authToken);
        });

      return {
        getClient,
      };
    }),
  },
) {}

/**
 * Live implementation of TrpcClientService
 */
export const TrpcClientServiceLive = TrpcClientService.Default;

// Re-export error types for consumers
export { ApiError, NetworkError, AuthTokenMissingError };
