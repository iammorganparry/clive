"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSignIn } from "@clerk/nextjs";
import { LoginForm } from "@clive/ui";
import { Card } from "@clive/ui/card";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const { isLoaded, signIn, setActive } = useSignIn();
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
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    setError(null);

    try {
      // Start the sign-in process with email
      const result = await signIn.create({
        identifier: email,
      });

      // Check if we need to complete with password or magic link
      if (result.status === "needs_second_factor") {
        // Handle 2FA if needed
        setError("Two-factor authentication is required");
        setIsLoading(false);
        return;
      }

      if (result.status === "complete") {
        // Sign-in is complete, set the session
        await setActive({ session: result.createdSessionId });
        router.push(afterSignInUrl);
      } else {
        // Need to verify email with magic link
        // Get the first email address ID
        const emailAddressId = result.supportedFirstFactors?.find(
          (factor) => factor.strategy === "email_code",
        )?.emailAddressId;

        if (emailAddressId) {
          await signIn.prepareFirstFactor({
            strategy: "email_code",
            emailAddressId,
          });
          setError(
            "Please check your email for a verification code. Password authentication is not yet supported.",
          );
        } else {
          setError(
            "Email verification is required. Please check your email for a magic link.",
          );
        }
        setIsLoading(false);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in";
      setError(errorMessage);
      setIsLoading(false);
    }
  };

  const handleGitHubClick = async () => {
    if (!isLoaded || !signIn) return;

    setIsLoading(true);
    setError(null);

    try {
      // Redirect to GitHub OAuth
      await signIn.authenticateWithRedirect({
        strategy: "oauth_github",
        redirectUrl: `${window.location.origin}${afterSignInUrl}`,
        redirectUrlComplete: `${window.location.origin}${afterSignInUrl}`,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to sign in with GitHub";
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
          title="Welcome to Clive"
          signUpLink={signUpUrl}
          signUpText="Don't have an account?"
          onSubmit={handleEmailSubmit}
          onGitHubClick={handleGitHubClick}
          isLoading={isLoading}
          error={error}
        />
      </Card>
    </div>
  );
}
