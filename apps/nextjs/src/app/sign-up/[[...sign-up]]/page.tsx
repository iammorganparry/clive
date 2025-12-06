import { SignUp } from "@clerk/nextjs";
import { headers } from "next/headers";

interface SignUpPageProps {
	searchParams: Promise<{ callback_url?: string }>;
}

/**
 * Get the base URL for the current request
 */
async function getBaseUrl(): Promise<string> {
	const headersList = await headers();
	const host = headersList.get("host");
	const protocol = headersList.get("x-forwarded-proto") || "http";
	
	if (host) {
		return `${protocol}://${host}`;
	}
	
	// Fallback for development
	return process.env.VERCEL_URL 
		? `https://${process.env.VERCEL_URL}`
		: "http://localhost:3000";
}

/**
 * Custom sign-up page for VS Code extension
 * Handles callback_url parameter and redirects to OAuth callback after authentication
 */
export default async function SignUpPage(props: SignUpPageProps) {
    const searchParams = await props.searchParams;
    const params = await searchParams;
    const callbackUrl = params.callback_url || "vscode://clive.auth/callback";

    // Build the callback URL that Clerk will redirect to after OAuth
    const baseUrl = await getBaseUrl();
    const afterSignUpUrl = new URL("/api/auth/oauth-callback", baseUrl);
    afterSignUpUrl.searchParams.set("redirect_url", callbackUrl);

    return (
		<div className="flex items-center justify-center min-h-screen p-6">
			<SignUp
				redirectUrl={afterSignUpUrl.toString()}
				fallbackRedirectUrl="/"
			/>
		</div>
	);
}

