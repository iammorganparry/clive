/**
 * Shared test helpers for AI agent tool tests
 */

/**
 * Helper function to execute tool and handle async results
 * Handles both synchronous and AsyncIterable results
 */
export async function executeTool<TInput, TOutput>(
  tool: { execute?: (...args: any[]) => any },
  input: TInput,
  defaultResult: TOutput,
): Promise<TOutput> {
  if (!tool.execute) {
    throw new Error("Tool execute function is undefined");
  }

  const result = await tool.execute(input, {
    toolCallId: "test-call-id",
    messages: [],
  });

  // Handle AsyncIterable if needed
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    const results: TOutput[] = [];
    for await (const value of result as AsyncIterable<TOutput>) {
      results.push(value);
    }
    return results[results.length - 1] ?? defaultResult;
  }

  return result as TOutput;
}

