import { type Effect, Runtime } from "effect";
import {
  isZodSchema,
  type RpcMessage,
  type RpcResponse,
  type RpcSubscriptionUpdate,
  type RouterRecord,
  type Procedure,
} from "@clive/webview-rpc";
import { appRouter } from "./router.js";
import type { RpcContext } from "./context.js";

const runtime = Runtime.defaultRuntime;

/**
 * Handle an RPC message from the webview
 */
export async function handleRpcMessage(
  message: RpcMessage,
  ctx: RpcContext,
): Promise<RpcResponse | null> {
  const { id, type, path, input } = message;

  // Handle unsubscribe
  if (input && typeof input === "object" && "_unsubscribe" in input) {
    // Subscription cancelled by client - we could track active subscriptions here
    return null;
  }

  try {
    // Navigate to the procedure
    const procedure = getProcedure(appRouter, path);
    if (!procedure) {
      return {
        id,
        success: false,
        error: { message: `Procedure not found: ${path.join(".")}` },
      };
    }

    const procedureDef = procedure._def;

    // Validate the procedure type matches the request type
    if (procedureDef.type !== type) {
      return {
        id,
        success: false,
        error: {
          message: `Invalid procedure type: expected ${procedureDef.type}, got ${type}`,
        },
      };
    }

    // Validate input if schema is provided
    // At runtime, procedureDef.input is a Zod schema (not the inferred type)
    let validatedInput = input;
    if (isZodSchema(procedureDef.input)) {
      const parseResult = procedureDef.input.safeParse(input);
      if (!parseResult.success) {
        return {
          id,
          success: false,
          error: { message: `Invalid input: ${parseResult.error.message}` },
        };
      }
      validatedInput = parseResult.data;
    }

    // Execute based on type
    if (type === "query" || type === "mutation") {
      const handler = procedureDef.handler as (opts: {
        input: unknown;
        ctx: RpcContext;
      }) => Effect.Effect<unknown, unknown, never>;

      const result = await Runtime.runPromise(runtime)(
        handler({ input: validatedInput, ctx }),
      );

      return {
        id,
        success: true,
        data: result,
      };
    }

    if (type === "subscription") {
      // For subscriptions, we need to stream updates
      const handler = procedureDef.handler as (opts: {
        input: unknown;
        ctx: RpcContext;
        signal: AbortSignal;
        onProgress?: (data: unknown) => void;
      }) => AsyncGenerator<unknown, unknown, unknown>;

      const abortController = new AbortController();

      // Progress callback sends updates to webview
      const onProgress = (data: unknown) => {
        const update: RpcSubscriptionUpdate = {
          id,
          type: "data",
          data,
        };
        ctx.webviewView.webview.postMessage(update);
      };

      try {
        const generator = handler({
          input: validatedInput,
          ctx,
          signal: abortController.signal,
          onProgress,
        });

        // Iterate through the generator manually to capture return value
        let iterResult = await generator.next();

        while (!iterResult.done) {
          // Send intermediate values
          const update: RpcSubscriptionUpdate = {
            id,
            type: "data",
            data: iterResult.value,
          };
          ctx.webviewView.webview.postMessage(update);

          iterResult = await generator.next();
        }

        // Capture the return value from the final done: true result
        const result: unknown = iterResult.value;

        // Send completion
        const completeUpdate: RpcSubscriptionUpdate = {
          id,
          type: "complete",
          data: result,
        };
        ctx.webviewView.webview.postMessage(completeUpdate);

        return null; // No direct response for subscriptions
      } catch (error) {
        const errorUpdate: RpcSubscriptionUpdate = {
          id,
          type: "error",
          error: {
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
        ctx.webviewView.webview.postMessage(errorUpdate);
        return null;
      }
    }

    return {
      id,
      success: false,
      error: { message: `Unknown procedure type: ${type}` },
    };
  } catch (error) {
    return {
      id,
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    };
  }
}

/**
 * Navigate to a procedure by path
 */
function getProcedure(
  router: RouterRecord,
  path: string[],
): Procedure<
  unknown,
  unknown,
  unknown,
  "query" | "mutation" | "subscription"
> | null {
  let current:
    | RouterRecord
    | Procedure<
        unknown,
        unknown,
        unknown,
        "query" | "mutation" | "subscription"
      > = router;

  for (const segment of path) {
    if (!current || typeof current !== "object") {
      return null;
    }

    if ("_def" in current) {
      // Already at a procedure, but path continues - invalid
      return null;
    }

    current = (current as RouterRecord)[segment] as
      | RouterRecord
      | Procedure<
          unknown,
          unknown,
          unknown,
          "query" | "mutation" | "subscription"
        >;
  }

  if (current && typeof current === "object" && "_def" in current) {
    return current as Procedure<
      unknown,
      unknown,
      unknown,
      "query" | "mutation" | "subscription"
    >;
  }

  return null;
}

/**
 * Check if a message is an RPC message
 */
export function isRpcMessage(message: unknown): message is RpcMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "id" in message &&
    "type" in message &&
    "path" in message &&
    typeof (message as RpcMessage).id === "string" &&
    Array.isArray((message as RpcMessage).path) &&
    ["query", "mutation", "subscription"].includes((message as RpcMessage).type)
  );
}
