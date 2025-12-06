"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@clive/ui/button";
import { Input } from "@clive/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";

export default function CallbackPage() {
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const token = searchParams.get("token");
  const error = searchParams.get("error");
  const errorMessage = searchParams.get("message");
  const redirectUrl = searchParams.get("redirect_url");

  useEffect(() => {
    // Reset copied state after 2 seconds
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const handleCopy = async () => {
    if (token) {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    }
  };

  const handleTryDeepLink = () => {
    if (token && redirectUrl) {
      const deepLinkUrl = new URL(redirectUrl);
      deepLinkUrl.searchParams.set("token", token);
      window.location.href = deepLinkUrl.toString();
    }
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">
              Authentication Error
            </CardTitle>
            <CardDescription>{errorMessage || error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No Token Received</CardTitle>
            <CardDescription>
              No authentication token was found in the callback.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Authentication Successful</CardTitle>
          <CardDescription>
            Copy your authentication token below:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              type="text"
              value={token}
              readOnly
              className="font-mono text-sm"
            />
            <Button onClick={handleCopy} variant="outline" size="default">
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
          {redirectUrl && (
            <Button
              onClick={handleTryDeepLink}
              className="w-full"
              variant="default"
            >
              Open in VS Code Extension
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            {redirectUrl
              ? "Click the button above to open in VS Code, or copy the token and paste it manually in the extension."
              : "Paste this token into the extension to authenticate."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
