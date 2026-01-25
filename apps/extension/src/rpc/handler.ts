import {
  isZodSchema,
  type Procedure,
  type RouterRecord,
  type RpcMessage,
  type RpcResponse,
  type RpcSubscriptionMessage,
  type RpcSubscriptionUpdate,
} from "@clive/webview-rpc";
import { type Effect, Runtime } from "effect";
import type { RpcContext } from "./context.js";
import { appRouter } from "./router.js";

const runtime = Runtime.defaultRuntime;

/**
 * Track active subscriptions and their message handlers
 */
interface ActiveSubscription {
  generator: AsyncGenerator<unknown, unknown, unknown>;
  abortController: AbortController;
  messageQueue: Map<string, (value: unknown) => void>; // toolCallId -> resolver
}

const activeSubscriptions = new Map<string, ActiveSubscription>();

/**
 * Handle a subscription message (approval, cancellation, etc.)
 */
export function handleSubscriptionMessage(
  message: RpcSubscriptionMessage,
  _ctx: RpcContext,
): boolean {
  const subscription = activeSubscriptions.get(message.subscriptionId);
  if (!subscription) {
    return false;
  }

  if (message.type === "approval" && message.toolCallId) {
    const resolver = subscription.messageQueue.get(message.toolCallId);
    if (resolver) {
      subscription.messageQueue.delete(message.toolCallId);
      resolver(message.data);
      return true;
    }
  } else if (message.type === "cancel") {
    subscription.abortController.abort();
    activeSubscriptions.delete(message.subscriptionId);
    return true;
  }

  return false;
}

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
    // Subscription cancelled by client - abort the active subscription
    const subscription = activeSubscriptions.get(id);
    if (subscription) {
      console.log(
        `[RpcHandler] Cancellation requested for subscription: ${id}`,
      );
      ctx.outputChannel?.appendLine(
        `[RpcHandler] Cancellation requested for subscription: ${id}`,
      );
      subscription.abortController.abort();
      activeSubscriptions.delete(id);
      console.log(`[RpcHandler] Subscription aborted and cleaned up: ${id}`);
      ctx.outputChannel?.appendLine(
        `[RpcHandler] Subscription aborted and cleaned up: ${id}`,
      );
    } else {
      console.log(
        `[RpcHandler] Cancellation requested but subscription not found: ${id}`,
      );
    }
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
        waitForApproval?: (toolCallId: string) => Promise<unknown>;
      }) => AsyncGenerator<unknown, unknown, unknown>;

      const abortController = new AbortController();
      const messageQueue = new Map<string, (value: unknown) => void>();

      // Progress callback sends updates to webview
      const onProgress = (data: unknown) => {
        const update: RpcSubscriptionUpdate = {
          id,
          type: "data",
          data,
        };
        ctx.webviewView.webview.postMessage(update);
      };

      // Wait for approval callback - used by generators to pause for user input
      const waitForApproval = (toolCallId: string): Promise<unknown> => {
        return new Promise((resolve) => {
          messageQueue.set(toolCallId, resolve);
        });
      };

      // Track this subscription
      const subscription: ActiveSubscription = {
        generator: null as unknown as AsyncGenerator<unknown, unknown, unknown>,
        abortController,
        messageQueue,
      };
      activeSubscriptions.set(id, subscription);

      try {
        const generator = handler({
          input: validatedInput,
          ctx,
          signal: abortController.signal,
          onProgress,
          waitForApproval,
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
        ctx.webviewView.webview.postMessage(errorUpdate);
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
