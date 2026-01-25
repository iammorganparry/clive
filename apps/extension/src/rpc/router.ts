import { createRouter } from "@clive/webview-rpc";
import type { RpcContext } from "./context.js";
import { agentsRouter } from "./routers/agents.js";
import { authRouter } from "./routers/auth.js";
import { configRouter } from "./routers/config.js";
import { conversationsRouter } from "./routers/conversations.js";
import { knowledgeBaseRouter } from "./routers/knowledge-base.js";
import { statusRouter } from "./routers/status.js";
import { systemRouter } from "./routers/system.js";

const { router } = createRouter<RpcContext>();

/**
 * Root RPC router
 */
export const appRouter = router({
  status: statusRouter,
  agents: agentsRouter,
  auth: authRouter,
  config: configRouter,
  conversations: conversationsRouter,
  knowledgeBase: knowledgeBaseRouter,
  system: systemRouter,
});

export type AppRouter = typeof appRouter;
