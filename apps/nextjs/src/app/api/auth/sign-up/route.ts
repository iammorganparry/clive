import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Sign-up API route that redirects to Clerk OAuth
 * After OAuth completes, Clerk redirects to our callback route
 */
export async function GET(request: NextRequest) {
	const searchParams = request.nextUrl.searchParams;
	const redirectUrl = searchParams.get("redirect_url") || "vscode://clive.auth/callback";

	// Build the callback URL that Clerk will redirect to after OAuth
	const callbackUrl = new URL("/api/auth/oauth-callback", request.nextUrl.origin);
	callbackUrl.searchParams.set("redirect_url", redirectUrl);

	// Use Clerk's OAuth URL builder
	// For GitHub OAuth, we redirect to Clerk's sign-up page with redirect to our callback
	const signUpUrl = new URL("https://accounts.clerk.dev/sign-up");
	signUpUrl.searchParams.set("redirect_url", callbackUrl.toString());
	signUpUrl.searchParams.set("oauth_github", "true");

	return NextResponse.redirect(signUpUrl.toString());
}

