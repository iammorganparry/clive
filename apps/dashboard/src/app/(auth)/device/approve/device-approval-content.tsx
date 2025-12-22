"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@clive/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@clive/ui/avatar";
import { ResultCard } from "@clive/ui";
import { CheckCircle2, XCircle, Laptop2, AlertCircle } from "lucide-react";

interface DeviceApprovalContentProps {
  userCode: string;
  user: {
    name: string;
    email: string;
    image?: string | null;
  };
}

async function approveDevice(userCode: string): Promise<void> {
  const response = await fetch("/api/auth/device/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userCode }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message ?? "Failed to approve device");
  }
}

async function denyDevice(userCode: string): Promise<void> {
  const response = await fetch("/api/auth/device/deny", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userCode }),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.message ?? "Failed to deny device");
  }
}

export function DeviceApprovalContent({
  userCode,
  user,
}: DeviceApprovalContentProps) {
  const router = useRouter();
  const [result, setResult] = useState<"approved" | "denied" | null>(null);

  const approveMutation = useMutation({
    mutationFn: () => approveDevice(userCode),
    onSuccess: () => setResult("approved"),
  });

  const denyMutation = useMutation({
    mutationFn: () => denyDevice(userCode),
    onSuccess: () => setResult("denied"),
  });

  const isProcessing = approveMutation.isPending || denyMutation.isPending;
  const error = approveMutation.error?.message ?? denyMutation.error?.message;

  const getInitials = () => {
    return (
      user.name
        ?.split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase() ?? "?"
    );
  };

  // Format code with dash
  const formatCode = (code: string) => {
    if (code.length > 4) {
      return `${code.slice(0, 4)}-${code.slice(4)}`;
    }
    return code;
  };

  if (result === "approved") {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <ResultCard
          variant="success"
          title="Device Approved"
          description="Your VS Code extension is now connected. You can close this window."
          action={{
            label: "Go to Dashboard",
            onClick: () => router.push("/"),
          }}
        />
      </div>
    );
  }

  if (result === "denied") {
    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <ResultCard
          variant="error"
          title="Device Denied"
          description="The device authorization request was denied. You can close this window."
          action={{
            label: "Go to Dashboard",
            onClick: () => router.push("/"),
          }}
        />
      </div>
    );
  }

  return (
    <Card className="w-full max-w-md border-0 bg-card/50 backdrop-blur">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/10">
          <Laptop2 className="size-6 text-primary" />
        </div>
        <CardTitle>Authorize Device</CardTitle>
        <CardDescription>
          A device is requesting access to your account.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* User info */}
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Avatar className="size-10">
            <AvatarImage src={user.image ?? undefined} alt={user.name} />
            <AvatarFallback>{getInitials()}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{user.name}</p>
            <p className="text-sm text-muted-foreground truncate">
              {user.email}
            </p>
          </div>
        </div>

        {/* Device code */}
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">Device Code</p>
          <p className="text-2xl font-mono font-bold tracking-widest">
            {formatCode(userCode)}
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => denyMutation.mutate()}
            disabled={isProcessing}
          >
            <XCircle className="mr-2 size-4" />
            {denyMutation.isPending ? "Denying..." : "Deny"}
          </Button>
          <Button
            className="flex-1"
            onClick={() => approveMutation.mutate()}
            disabled={isProcessing}
          >
            <CheckCircle2 className="mr-2 size-4" />
            {approveMutation.isPending ? "Approving..." : "Approve"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
