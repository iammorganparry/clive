import { createRouter } from "@clive/webview-rpc";
import { statusRouter } from "./routers/status.js";
import { agentsRouter } from "./routers/agents.js";
import type { RpcContext } from "./context.js";

const { router } = createRouter<RpcContext>();

/**
 * Root RPC router
 */
export const appRouter = router({
  status: statusRouter,
  agents: agentsRouter,
});

export type AppRouter = typeof appRouter;
