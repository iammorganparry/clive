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
import {
  CheckCircle2,
  Copy,
  Loader2,
  ExternalLink,
  ChevronDown,
} from "lucide-react";

function CallbackPageContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const [copied, setCopied] = useState(false);
  const [showToken, setShowToken] = useState(false);

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
    if (token && callbackUrl) {
      window.location.href = `${callbackUrl}?token=${encodeURIComponent(token)}`;
    }
  }, [token, callbackUrl]);

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
      <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
        <CardContent className="flex flex-col items-center justify-center py-16">
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
      <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
        <CardHeader className="text-center">
          <CardTitle className="text-destructive">
            Authentication Error
          </CardTitle>
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
      <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
        <CardHeader className="text-center">
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

  return (
    <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
      <CardHeader className="pb-4 text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-green-500/10">
          <CheckCircle2 className="size-6 text-green-500" />
        </div>
        <CardTitle>Authentication Successful</CardTitle>
        <CardDescription>
          {callbackUrl
            ? `Redirecting you to ${editorName}...`
            : "Copy the token below to complete sign in."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {callbackUrl && (
          <>
            <Button
              onClick={handleOpenEditor}
              variant="outline"
              className="w-full"
            >
              <ExternalLink className="mr-2 size-4" />
              Open {editorName} Manually
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>
          </>
        )}

        {showToken ? (
          <div className="space-y-3">
            <p className="text-center text-sm text-muted-foreground">
              Copy this token and paste it in the extension:
            </p>
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
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowToken(true)}
            className="flex w-full items-center justify-center gap-1 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown className="size-4" />
            Show token manually
          </button>
        )}
      </CardContent>
    </Card>
  );
}

export default function CallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense
        fallback={
          <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Loader2 className="size-8 animate-spin text-primary" />
              <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
            </CardContent>
          </Card>
        }
      >
        <CallbackPageContent />
      </Suspense>
    </div>
  );
}
