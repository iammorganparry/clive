import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractSessionToken } from "~/lib/auth/verify-token.js";

/**
 * OAuth callback handler for VS Code extension
 * This route handles the OAuth callback, extracts Clerk's session token,
 * and redirects to the VS Code deep link URL with the token
 */
export async function GET(request: NextRequest) {
	try {
		// Get authentication result from Clerk
		// This processes the OAuth callback and sets up the session
		const authResult = await auth();

		// Get the redirect URL from query params (should be the VS Code deep link)
		const searchParams = request.nextUrl.searchParams;
		const redirectUrl = searchParams.get("redirect_url") || "vscode://clive.auth/callback";

		if (!authResult.userId) {
			// If authentication failed, redirect to VS Code with error
			const errorUrl = new URL(redirectUrl);
			errorUrl.searchParams.set("error", "authentication_failed");
			return NextResponse.redirect(errorUrl.toString());
		}

		// Extract the Clerk session token from the request
		// This is a Clerk-generated JWT signed with RS256 algorithm
		// The token is in the __session cookie after Clerk processes the OAuth callback
		const sessionToken = extractSessionToken(request);

		if (!sessionToken) {
			// If no session token found, redirect with error
			const errorUrl = new URL(redirectUrl);
			errorUrl.searchParams.set("error", "no_session_token");
			errorUrl.searchParams.set("message", "Session token not found");
			return NextResponse.redirect(errorUrl.toString());
		}

		// Add token to redirect URL
		// The extension will store this token and send it in Authorization header
		const redirectUrlObj = new URL(redirectUrl);
		redirectUrlObj.searchParams.set("token", sessionToken);

		// Redirect to VS Code deep link with Clerk session token
		return NextResponse.redirect(redirectUrlObj.toString());
	} catch (error) {
		console.error("OAuth callback error:", error);
		const errorUrl = new URL("vscode://clive.auth/callback");
		errorUrl.searchParams.set("error", "callback_processing_failed");
		errorUrl.searchParams.set("message", error instanceof Error ? error.message : String(error));
		return NextResponse.redirect(errorUrl.toString());
	}
}

