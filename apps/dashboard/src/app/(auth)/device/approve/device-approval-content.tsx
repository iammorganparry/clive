"use client";

import { ResultCard } from "@clive/ui";
import { Avatar, AvatarFallback, AvatarImage } from "@clive/ui/avatar";
import { Button } from "@clive/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@clive/ui/card";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Laptop2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
			<div className="flex min-h-screen items-center justify-center p-6">
				<ResultCard
					action={{
						label: "Go to Dashboard",
						onClick: () => router.push("/"),
					}}
					description="Your VS Code extension is now connected. You can close this window."
					title="Device Approved"
					variant="success"
				/>
			</div>
		);
	}

	if (result === "denied") {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<ResultCard
					action={{
						label: "Go to Dashboard",
						onClick: () => router.push("/"),
					}}
					description="The device authorization request was denied. You can close this window."
					title="Device Denied"
					variant="error"
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
						<AvatarImage alt={user.name} src={user.image ?? undefined} />
						<AvatarFallback>{getInitials()}</AvatarFallback>
					</Avatar>
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium">{user.name}</p>
						<p className="truncate text-muted-foreground text-sm">
							{user.email}
						</p>
					</div>
				</div>

				{/* Device code */}
				<div className="text-center">
					<p className="mb-1 text-muted-foreground text-sm">Device Code</p>
					<p className="font-bold font-mono text-2xl tracking-widest">
						{formatCode(userCode)}
					</p>
				</div>

				{error && (
					<div className="flex items-center gap-2 text-destructive text-sm">
						<AlertCircle className="size-4" />
						{error}
					</div>
				)}

				{/* Actions */}
				<div className="flex gap-3">
					<Button
						className="flex-1"
						disabled={isProcessing}
						onClick={() => denyMutation.mutate()}
						variant="outline"
					>
						<XCircle className="mr-2 size-4" />
						{denyMutation.isPending ? "Denying..." : "Deny"}
					</Button>
					<Button
						className="flex-1"
						disabled={isProcessing}
						onClick={() => approveMutation.mutate()}
					>
						<CheckCircle2 className="mr-2 size-4" />
						{approveMutation.isPending ? "Approving..." : "Approve"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
