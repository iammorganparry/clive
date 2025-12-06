import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";

import { appRouter, type AppRouter } from "./root";
import { createCallerFactory } from "./trpc";

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

export { type AppRouter, appRouter } from "./root";
export const createCaller = createCallerFactory(appRouter);
export { createTRPCContext } from "./trpc";
export type { RouterInputs, RouterOutputs };
