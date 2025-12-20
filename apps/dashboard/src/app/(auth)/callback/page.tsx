"use client";

import { useState, Suspense, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Input } from "@clive/ui/input";
import { Field, FieldDescription, FieldGroup } from "@clive/ui/field";
import { CheckCircle2, Copy, Loader2, ExternalLink } from "lucide-react";

function CallbackPageContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const [copied, setCopied] = useState(false);
  const [redirectAttempted, setRedirectAttempted] = useState(false);
  const [showManualFallback, setShowManualFallback] = useState(false);

  const {
    data: token,
    isLoading: loading,
    error: queryError,
  } = useQuery({
    queryKey: ["extension-token"],
    queryFn: async () => {
      const response = await fetch("/api/auth/token", {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to generate token: ${response.status} ${errorText}`,
        );
      }

      const data = (await response.json()) as { token?: string };
      if (!data.token) {
        throw new Error("No token in response");
      }

      return data.token;
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const error = queryError?.message ?? null;

  // Build the deep link URL
  const deepLinkUrl =
    callbackUrl && token
      ? `${callbackUrl}?token=${encodeURIComponent(token)}`
      : null;

  // Detect editor from callback URL
  const editorName = callbackUrl?.startsWith("cursor://")
    ? "Cursor"
    : "VS Code";

  // Auto-redirect to deep link when token is ready
  useEffect(() => {
    if (token && callbackUrl && !redirectAttempted) {
      setRedirectAttempted(true);

      // Redirect to deep link
      window.location.href = `${callbackUrl}?token=${encodeURIComponent(token)}`;

      // Show manual fallback after a delay (in case redirect doesn't work)
      const fallbackTimer = setTimeout(() => {
        setShowManualFallback(true);
      }, 2000);

      return () => clearTimeout(fallbackTimer);
    }
  }, [token, callbackUrl, redirectAttempted]);

  const handleCopy = useCallback(async () => {
    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy token:", err);
    }
  }, [token]);

  const handleOpenEditor = useCallback(() => {
    if (deepLinkUrl) {
      window.location.href = deepLinkUrl;
    }
  }, [deepLinkUrl]);

  if (loading) {
    return (
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">
            Generating authentication token...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Authentication Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              window.location.href = "/sign-in";
            }}
            className="w-full"
          >
            Return to Sign In
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!token) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>No Token Available</CardTitle>
          <CardDescription>
            Unable to generate authentication token. Please try signing in
            again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              window.location.href = "/sign-in";
            }}
            className="w-full"
          >
            Return to Sign In
          </Button>
        </CardContent>
      </Card>
    );
  }

  // If we have a callback URL, show redirecting state
  if (callbackUrl && !showManualFallback) {
    return (
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <CheckCircle2 className="size-8 text-green-500" />
          <p className="mt-4 text-sm font-medium">Authentication Successful!</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Redirecting to {editorName}...
          </p>
          <Loader2 className="mt-4 size-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Manual fallback (shown if no callback URL or redirect didn't work)
  return (
    <Card className="max-w-lg rounded-xl p-4 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-green-500" />
          Authentication Successful
        </CardTitle>
        <CardDescription className="text-sm text-muted-foreground">
          {callbackUrl ? (
            <>
              If {editorName} didn&apos;t open automatically, click the button
              below or copy the token manually.
            </>
          ) : (
            <>
              Copy the token below and paste it into the extension login page.
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {callbackUrl && (
          <Button onClick={handleOpenEditor} className="w-full">
            <ExternalLink className="mr-2 size-4" />
            Open in {editorName}
          </Button>
        )}

        <FieldGroup>
          <Field>
            <FieldDescription className="mb-2">
              Or copy the token manually:
            </FieldDescription>
            <div className="flex gap-2">
              <Input
                type="text"
                value={token}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                className="shrink-0"
              >
                {copied ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <Card className="max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      }
    >
      <CallbackPageContent />
    </Suspense>
  );
}
