import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

/**
 * Signup page for VS Code extension
 * Redirects to custom Clerk sign-up page
 */
export default async function SignupPage({
	searchParams,
}: {
	searchParams: Promise<{ callback_url?: string }>;
}) {
	const params = await searchParams;
	const callbackUrl = params.callback_url || "vscode://clive.auth/callback";

	// Check if user is already authenticated
	const { userId } = await auth();
	if (userId) {
		// User is already authenticated, redirect to callback with token
		return redirect(`/api/auth/oauth-callback?redirect_url=${encodeURIComponent(callbackUrl)}`);
	}

	// Redirect to custom Clerk sign-up page
	return redirect(
		`/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`
	);
}

