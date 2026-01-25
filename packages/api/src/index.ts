import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { type AppRouter, appRouter } from "./root.js";
import { createCallerFactory } from "./trpc.js";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: number }
 */
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 */
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { type AppRouter, appRouter } from "./root.js";
export const createCaller = createCallerFactory(appRouter);
export { createTRPCContext } from "./trpc.js";
export type { RouterInputs, RouterOutputs };
