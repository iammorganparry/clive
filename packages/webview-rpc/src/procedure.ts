import type { Effect } from "effect";
import type { z } from "zod";
import type { Procedure } from "./types.js";

/**
 * Procedure builder for creating type-safe RPC procedures
 */
export interface ProcedureBuilder<TContext> {
  input: <TInput extends z.ZodTypeAny>(
    schema: TInput,
  ) => ProcedureBuilderWithInput<TContext, z.infer<TInput>>;
}

export interface ProcedureBuilderWithInput<TContext, TInput> {
  query: <TOutput>(
    handler: (opts: {
      input: TInput;
      ctx: TContext;
    }) => Effect.Effect<TOutput, unknown>,
  ) => Procedure<TInput, TOutput, TContext, "query">;

  mutation: <TOutput>(
    handler: (opts: {
      input: TInput;
      ctx: TContext;
    }) => Effect.Effect<TOutput, unknown>,
  ) => Procedure<TInput, TOutput, TContext, "mutation">;

  subscription: <TOutput>(
    handler: (opts: {
      input: TInput;
      ctx: TContext;
      signal: AbortSignal;
      onProgress?: (data: unknown) => void;
      waitForApproval?: (toolCallId: string) => Promise<unknown>;
      subscriptionId?: string;
    }) => AsyncGenerator<unknown, TOutput, unknown>,
  ) => Procedure<TInput, TOutput, TContext, "subscription">;
}

export function createProcedureBuilder<TContext>(): ProcedureBuilder<TContext> {
  return {
    input: <TInput extends z.ZodTypeAny>(schema: TInput) => {
      type InferredInput = z.infer<TInput>;
      return {
        query: <TOutput>(
          handler: (opts: {
            input: InferredInput;
            ctx: TContext;
          }) => Effect.Effect<TOutput, unknown>,
        ) => {
          return {
            _def: {
              input: schema,
              output: undefined as TOutput,
              context: undefined as TContext,
              type: "query" as const,
              handler,
            },
          } as unknown as Procedure<InferredInput, TOutput, TContext, "query">;
        },

        mutation: <TOutput>(
          handler: (opts: {
            input: InferredInput;
            ctx: TContext;
          }) => Effect.Effect<TOutput, unknown>,
        ) => {
          return {
            _def: {
              input: schema,
              output: undefined as TOutput,
              context: undefined as TContext,
              type: "mutation" as const,
              handler,
            },
          } as unknown as Procedure<
            InferredInput,
            TOutput,
            TContext,
            "mutation"
          >;
        },

        subscription: <TOutput>(
          handler: (opts: {
            input: InferredInput;
            ctx: TContext;
            signal: AbortSignal;
            onProgress?: (data: unknown) => void;
            waitForApproval?: (toolCallId: string) => Promise<unknown>;
            subscriptionId?: string;
          }) => AsyncGenerator<unknown, TOutput, unknown>,
        ) => {
          return {
            _def: {
              input: schema,
              output: undefined as TOutput,
              context: undefined as TContext,
              type: "subscription" as const,
              handler,
            },
          } as unknown as Procedure<
            InferredInput,
            TOutput,
            TContext,
            "subscription"
          >;
        },
      };
    },
  };
}
