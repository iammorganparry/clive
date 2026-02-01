import { authRouter } from "./router/auth.js";
import { configRouter } from "./router/config.js";
import { conversationRouter } from "./router/conversation.js";
import { memoryRouter } from "./router/memory.js";
import { postRouter } from "./router/post.js";
import { repositoryRouter } from "./router/repository.js";
import { createTRPCRouter } from "./trpc.js";

const _appRouter = createTRPCRouter({
  auth: authRouter,
  config: configRouter,
  conversation: conversationRouter,
  memory: memoryRouter,
  post: postRouter,
  repository: repositoryRouter,
});

export const appRouter: typeof _appRouter = _appRouter;

// export type definition of API
export type AppRouter = typeof appRouter;
