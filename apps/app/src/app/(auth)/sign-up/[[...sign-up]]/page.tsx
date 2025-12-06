"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignUp } from "@clerk/nextjs";
import { LoginForm } from "@clive/ui";
import { Card } from "@clive/ui/card";

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const { isLoaded, signUp, setActive } = useSignUp();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Build redirect URL - if callback_url is present, redirect to callback page with it
  const afterSignUpUrl = callbackUrl
    ? `/callback?callback_url=${encodeURIComponent(callbackUrl)}`
    : "/";

  const signInUrl = callbackUrl
    ? `/sign-in?callback_url=${encodeURIComponent(callbackUrl)}`
    : "/sign-in";

  const handleEmailSubmit = async (email: string) => {
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    setError(null);

    try {
      // Start the sign-up process with email
      const result = await signUp.create({
        emailAddress: email,
      });

      // Check if we need to verify email
      if (result.status === "complete") {
        // Sign-up is complete, set the session
        await setActive({ session: result.createdSessionId });
        router.push(afterSignUpUrl);
      } else {
        // Need to verify email with magic link
        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });
        setError("Please check your email for a verification code.");
        setIsLoading(false);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign up";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const handleGitHubClick = async () => {
    if (!isLoaded || !signUp) return;

    setIsLoading(true);
    setError(null);

    try {
      // Redirect to GitHub OAuth
      await signUp.authenticateWithRedirect({
        strategy: "oauth_github",
        redirectUrl: `${window.location.origin}${afterSignUpUrl}`,
        redirectUrlComplete: `${window.location.origin}${afterSignUpUrl}`,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign up with GitHub";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  if (!isLoaded) {
    return (
      <Card>
        <div className="flex items-center justify-center p-12">
          <div className="text-sm text-muted-foreground">Loading...</div>
        </div>
      </Card>
    );
  }

  return (
    <div className="flex items-center justify-center">
      <Card className="w-full max-w-md">
        <LoginForm
          title="Create an account"
          signUpLink={signInUrl}
          signUpText="Already have an account?"
          onSubmit={handleEmailSubmit as (email: string) => Promise<void>}
          onGitHubClick={handleGitHubClick}
          isLoading={isLoading}
          error={error}
        />
      </Card>
    </div>
  );
}
