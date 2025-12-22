import { authRouter } from "./router/auth";
import { configRouter } from "./router/config";
import { conversationRouter } from "./router/conversation";
import { postRouter } from "./router/post";
import { repositoryRouter } from "./router/repository";
import { createTRPCRouter } from "./trpc";

const _appRouter = createTRPCRouter({
  auth: authRouter,
  config: configRouter,
  conversation: conversationRouter,
  post: postRouter,
  repository: repositoryRouter,
});

export const appRouter: typeof _appRouter = _appRouter;

// export type definition of API
export type AppRouter = typeof appRouter;
