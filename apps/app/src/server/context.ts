import { auth } from "@clerk/nextjs/server";

export const createContext = async (req: Request) => {
  return { auth: await auth(), headers: req.headers };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
