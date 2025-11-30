import type { NextRequest } from "next/server";

/**
 * Extract session token from request
 * Checks both Authorization header (for cross-origin) and __session cookie (for same-origin)
 *
 * This is used to extract Clerk session tokens that can be verified using
 * Clerk's authenticateRequest() method, which handles:
 * - Token signature verification using Clerk's public key (RS256)
 * - Expiration validation (exp claim)
 * - Not before validation (nbf claim)
 * - Authorized parties validation (azp claim) for CSRF protection
 * - Algorithm verification
 *
 * @param request - The Next.js request object
 * @returns The session token if found, null otherwise
 */
export function extractSessionToken(request: NextRequest): string | null {
	// Check Authorization header first (for cross-origin requests from VS Code extension)
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return authHeader.substring(7);
	}

	// Check __session cookie (for same-origin requests)
	const sessionCookie = request.cookies.get("__session")?.value;
	if (sessionCookie) {
		return sessionCookie;
	}

	return null;
}

