import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { extractSessionToken } from "~/lib/auth/verify-token";

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
    const redirectUrl =
      searchParams.get("redirect_url") || "vscode://clive.auth/callback";

    if (!authResult.userId) {
      // If authentication failed, redirect to callback page with error
      const callbackPageUrl = new URL("/auth/callback", request.url);
      callbackPageUrl.searchParams.set("error", "authentication_failed");
      callbackPageUrl.searchParams.set("message", "Authentication failed");
      return NextResponse.redirect(callbackPageUrl.toString());
    }

    // Extract the Clerk session token from the request
    // This is a Clerk-generated JWT signed with RS256 algorithm
    // The token is in the __session cookie after Clerk processes the OAuth callback
    const sessionToken = extractSessionToken(request);

    if (!sessionToken) {
      // If no session token found, redirect to callback page with error
      const callbackPageUrl = new URL("/auth/callback", request.url);
      callbackPageUrl.searchParams.set("error", "no_session_token");
      callbackPageUrl.searchParams.set("message", "Session token not found");
      return NextResponse.redirect(callbackPageUrl.toString());
    }

    // Always show the callback page so users can copy the token
    // This serves as a fallback if the VS Code deep link doesn't work
    const callbackPageUrl = new URL("/auth/callback", request.url);
    callbackPageUrl.searchParams.set("token", sessionToken);
    // Also include redirect_url so the page can offer to try the deep link
    if (redirectUrl) {
      callbackPageUrl.searchParams.set("redirect_url", redirectUrl);
    }
    return NextResponse.redirect(callbackPageUrl.toString());
  } catch (error) {
    console.error("OAuth callback error:", error);
    const callbackPageUrl = new URL("/auth/callback", request.url);
    callbackPageUrl.searchParams.set("error", "callback_processing_failed");
    callbackPageUrl.searchParams.set(
      "message",
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.redirect(callbackPageUrl.toString());
  }
}
