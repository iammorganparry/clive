"use client";

import { authClient } from "@clive/auth/client";
import { LoginForm } from "@clive/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build redirect URL - if callback_url is present, redirect to callback page with it
  const afterSignInUrl = callbackUrl
    ? `/callback?callback_url=${encodeURIComponent(callbackUrl)}`
    : "/";

  const signUpUrl = callbackUrl
    ? `/sign-up?callback_url=${encodeURIComponent(callbackUrl)}`
    : "/sign-up";

  const handleEmailSubmit = async (email: string) => {
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
        callbackURL: afterSignInUrl,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with GitHub";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center">
      <LoginForm
        title="Clive"
        description="Your AI E2E Test Writer"
        signUpLink={signUpUrl}
        signUpText="Don't have an account?"
        onSubmit={handleEmailSubmit}
        onGitHubClick={handleGitHubClick}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}
