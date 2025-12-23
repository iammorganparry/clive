import { authRouter } from "./router/auth";
import { configRouter } from "./router/config";
import { conversationRouter } from "./router/conversation";
import { knowledgeBaseRouter } from "./router/knowledge-base";
import { postRouter } from "./router/post";
import { repositoryRouter } from "./router/repository";
import { createTRPCRouter } from "./trpc";

const _appRouter = createTRPCRouter({
  auth: authRouter,
  config: configRouter,
  conversation: conversationRouter,
  knowledgeBase: knowledgeBaseRouter,
  post: postRouter,
  repository: repositoryRouter,
});

export const appRouter: typeof _appRouter = _appRouter;

// export type definition of API
export type AppRouter = typeof appRouter;
