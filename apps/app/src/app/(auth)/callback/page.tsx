"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
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
import { CheckCircle2, Copy, Loader2 } from "lucide-react";
import { api } from "~/trpc/react";

function CallbackPageContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callback_url");
  const [copied, setCopied] = useState(false);

  const {
    data: tokenData,
    isLoading: loading,
    error: queryError,
  } = api.auth.getExtensionToken.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  const token = tokenData?.token ?? null;
  const error = queryError?.message ?? null;

  const handleCopy = async () => {
    if (!token) return;

    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy token:", err);
    }
  };

  if (loading) {
    return (
      <Card>
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
      <Card>
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
      <Card>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle2 className="size-5 text-green-500" />
          Authentication Successful
        </CardTitle>
        <CardDescription>
          Copy the token below and paste it into the VSCode extension login
          page.
          {callbackUrl && (
            <>
              {" "}
              Alternatively, you can use this deep link:{" "}
              <a
                href={`${callbackUrl}?token=${encodeURIComponent(token ?? "")}`}
                className="text-primary underline"
              >
                Open in VSCode
              </a>
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <div className="flex gap-2">
              <Input
                type="text"
                value={token}
                readOnly
                className="font-mono text-sm"
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
          <FieldDescription>
            Click the copy button or select the token above to copy it. Then
            paste it into the VSCode extension login page.
          </FieldDescription>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

export default function CallbackPage() {
  return (
    <Suspense
      fallback={
        <Card>
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
