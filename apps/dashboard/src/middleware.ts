import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

const publicRoutes = ["/sign-in", "/sign-up", "/api/auth", "/api/trpc"];

// Routes that accept Bearer token authentication
const bearerAuthRoutes = ["/api/ai"];

export function middleware(request: NextRequest) {
	const isPublicRoute = publicRoutes.some((route) =>
		request.nextUrl.pathname.startsWith(route),
	);

	if (isPublicRoute) return NextResponse.next();

	// Check for Bearer token on specific API routes
	const isBearerAuthRoute = bearerAuthRoutes.some((route) =>
		request.nextUrl.pathname.startsWith(route),
	);

	if (isBearerAuthRoute) {
		const authHeader = request.headers.get("authorization");
		if (authHeader?.startsWith("Bearer ")) {
			// Let the route handler validate the token
			return NextResponse.next();
		}
	}

	const sessionCookie = getSessionCookie(request);
	if (!sessionCookie) {
		return NextResponse.redirect(new URL("/sign-in", request.url));
	}

	return NextResponse.next();
}

export const config = {
	matcher: [
		// Skip Next.js internals and all static files, unless found in search params
		"/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
		// Always run for API routes
		"/(api|trpc)(.*)",
	],
};
