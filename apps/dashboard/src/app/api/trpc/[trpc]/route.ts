import { appRouter, createTRPCContext } from "@clive/api";
import { auth } from "@clive/auth";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { NextRequest } from "next/server";
import { env } from "~/env";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
	// Debug: Log auth header presence
	const authHeader = req.headers.get("authorization");
	if (env.NODE_ENV === "development") {
		console.log(
			`[tRPC Auth] Authorization header: ${authHeader ? `Bearer ...${authHeader.slice(-20)}` : "none"}`,
		);
	}

	const session = await auth.api.getSession({
		headers: req.headers,
	});

	// Debug: Log session result
	if (env.NODE_ENV === "development") {
		console.log(
			`[tRPC Auth] Session result: ${session?.user?.id ? `user=${session.user.id}` : "null"}`,
		);
	}

	if (!session?.user.id) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}
	return createTRPCContext({
		headers: req.headers,
		session,
	});
};

const handler = (req: NextRequest) =>
	fetchRequestHandler({
		endpoint: "/api/trpc",
		req,
		router: appRouter,
		createContext: () => createContext(req),

		onError:
			env.NODE_ENV === "development"
				? ({ path, error }) => {
						// Truncate long arrays (like embeddings) and content in error messages
						let message = error.message;

						// Truncate arrays of numbers (embeddings): [num,num,num,...]
						// Matches arrays with 50+ comma-separated numbers
						message = message.replace(
							/\[(-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){50,})\]/g,
							(match) => {
								const numbers = match.slice(1, -1).split(",");
								if (numbers.length > 10) {
									return `[${numbers.slice(0, 5).join(",")},...${numbers.length - 5} more values]`;
								}
								return match;
							},
						);

						// Truncate the entire params section if it's too long
						// This handles long file content and other large values
						message = message.replace(
							/(params:)([^\n]{1000,})/g,
							(match, prefix, params) => {
								if (params.length > 1000) {
									return `${prefix}${params.slice(0, 500)}...${params.length - 500} more chars`;
								}
								return match;
							},
						);

						// If the entire message is still too long, truncate it
						const MAX_MESSAGE_LENGTH = 2000;
						if (message.length > MAX_MESSAGE_LENGTH) {
							message = `${message.slice(0, MAX_MESSAGE_LENGTH)}...${message.length - MAX_MESSAGE_LENGTH} more chars`;
						}

						console.error(
							`❌ tRPC failed on ${path ?? "<no-path>"}: ${message}`,
						);
					}
				: undefined,
	});

export { handler as GET, handler as POST };
