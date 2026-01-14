#!/usr/bin/env node
/**
 * TUI RPC Server
 *
 * Standalone process that handles RPC requests from the TUI client.
 * Communicates via stdin/stdout using NDJSON format.
 */

import * as readline from "node:readline";
import {
  isZodSchema,
  type Procedure,
  type RouterRecord,
  type RpcMessage,
  type RpcResponse,
  type RpcSubscriptionUpdate,
} from "@clive/webview-rpc";
import { type Effect, Runtime } from "effect";
import { createRpcContext, type RpcContext } from "./context.js";
import { tuiRouter } from "./router.js";

const runtime = Runtime.defaultRuntime;

// Track active subscriptions
interface ActiveSubscription {
  generator: AsyncGenerator<unknown, unknown, unknown>;
  abortController: AbortController;
}

const activeSubscriptions = new Map<string, ActiveSubscription>();

/**
 * Send a message to the client (TUI)
 */
function sendMessage(message: RpcResponse | RpcSubscriptionUpdate): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
 * Handle an RPC message
 */
async function handleRpcMessage(
  message: RpcMessage,
  ctx: RpcContext,
): Promise<RpcResponse | null> {
  const { id, type, path, input } = message;

  // Handle unsubscribe
  if (input && typeof input === "object" && "_unsubscribe" in input) {
    const subscription = activeSubscriptions.get(id);
    if (subscription) {
      subscription.abortController.abort();
      activeSubscriptions.delete(id);
    }
    return null;
  }

  try {
    // Navigate to the procedure
    const procedure = getProcedure(tuiRouter, path);
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
      }) => AsyncGenerator<unknown, unknown, unknown>;

      const abortController = new AbortController();

      // Track this subscription
      const subscription: ActiveSubscription = {
        generator: null as unknown as AsyncGenerator<unknown, unknown, unknown>,
        abortController,
      };
      activeSubscriptions.set(id, subscription);

      try {
        const generator = handler({
          input: validatedInput,
          ctx,
          signal: abortController.signal,
        });

        subscription.generator = generator;

        // Iterate through the generator manually to capture return value
        let iterResult = await generator.next();

        while (!iterResult.done) {
          // Send intermediate values
          const update: RpcSubscriptionUpdate = {
            id,
            type: "data",
            data: iterResult.value,
          };
          sendMessage(update);

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
        sendMessage(completeUpdate);

        // Clean up
        activeSubscriptions.delete(id);

        return null; // No direct response for subscriptions
      } catch (error) {
        const errorUpdate: RpcSubscriptionUpdate = {
          id,
          type: "error",
          error: {
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
        sendMessage(errorUpdate);
        activeSubscriptions.delete(id);
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
 * Check if a message is an RPC message
 */
function isRpcMessage(message: unknown): message is RpcMessage {
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

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Create the RPC context
  const ctx = createRpcContext();

  // Set up stdin reading
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Number.POSITIVE_INFINITY,
  });

  // Handle each line as a potential RPC message
  rl.on("line", async (line: string) => {
    if (!line.trim()) return;

    try {
      const message = JSON.parse(line);

      if (!isRpcMessage(message)) {
        // Not an RPC message - ignore
        return;
      }

      const response = await handleRpcMessage(message, ctx);

      // Send response if there is one (subscriptions return null)
      if (response) {
        sendMessage(response);
      }
    } catch (err) {
      // JSON parse error - send error response if we can extract an ID
      console.error("[RpcServer] Failed to parse message:", err);
    }
  });

  // Handle process exit
  rl.on("close", () => {
    // Abort all active subscriptions
    for (const [_id, subscription] of activeSubscriptions) {
      subscription.abortController.abort();
    }
    activeSubscriptions.clear();
    process.exit(0);
  });
}

// Start the server
main().catch((err) => {
  console.error("[RpcServer] Fatal error:", err);
  process.exit(1);
});
