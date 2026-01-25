import { auth } from "@clive/auth";
import { headers } from "next/headers";

export const createContext = async (req: Request) => {
	const session = await auth.api.getSession({
		headers: await headers(),
	});
	return { session, headers: req.headers };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
