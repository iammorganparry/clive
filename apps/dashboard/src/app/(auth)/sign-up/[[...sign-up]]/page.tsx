"use client";

import { authClient } from "@clive/auth/client";
import { LoginForm } from "@clive/ui";
import { Card } from "@clive/ui/card";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function SignUpPage() {
	const _router = useRouter();
	const searchParams = useSearchParams();
	const callbackUrl = searchParams.get("callback_url");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Build redirect URL - if callback_url is present, redirect to callback page with it
	const afterSignUpUrl = callbackUrl
		? `/callback?callback_url=${encodeURIComponent(callbackUrl)}`
		: "/";

	const signInUrl = callbackUrl
		? `/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`
		: "/sign-in";

	const handleEmailSubmit = async (_email: string) => {
		setIsLoading(true);
		setError(null);
		setError(
			"Email/password authentication is not yet configured. Please use GitHub sign-in.",
		);
		setIsLoading(false);
	};

	const handleGitHubClick = async () => {
		setIsLoading(true);
		setError(null);

		try {
			await authClient.signIn.social({
				provider: "github",
				callbackURL: afterSignUpUrl,
			});
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Failed to sign up with GitHub";
			setError(errorMessage);
			setIsLoading(false);
		}
	};

	return (
		<div className="flex items-center justify-center">
			<Card className="w-full max-w-md">
				<LoginForm
					error={error}
					isLoading={isLoading}
					onGitHubClick={handleGitHubClick}
					onSubmit={handleEmailSubmit as (email: string) => Promise<void>}
					signUpLink={signInUrl}
					signUpText="Already have an account?"
					title="Create an account"
				/>
			</Card>
		</div>
	);
}
