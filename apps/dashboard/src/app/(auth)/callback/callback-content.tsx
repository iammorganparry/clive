"use client";

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
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	Copy,
	ExternalLink,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export interface UserInfo {
	userId: string;
	email?: string | null;
	name?: string | null;
	image?: string | null;
	organizationId?: string | null;
}

interface CallbackContentProps {
	token: string | null;
	userInfo: UserInfo | null;
	error: string | null;
	callbackUrl: string | null;
}

export function CallbackContent({
	token,
	userInfo,
	error,
	callbackUrl,
}: CallbackContentProps) {
	const [copied, setCopied] = useState(false);
	const [copyError, setCopyError] = useState(false);
	const [showToken, setShowToken] = useState(false);

	const editorName = callbackUrl?.startsWith("cursor://")
		? "Cursor"
		: "VS Code";

	// Build deep link URL with token and user info
	// The extension will parse both from the URL and store them
	const deepLinkUrl =
		callbackUrl && token
			? `${callbackUrl}?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(userInfo))}`
			: null;

	// Auto-redirect to deep link when token is available
	useEffect(() => {
		if (deepLinkUrl) {
			window.location.href = deepLinkUrl;
		}
	}, [deepLinkUrl]);

	const handleCopy = useCallback(async () => {
		if (!token) return;

		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setCopyError(false);
			setTimeout(() => setCopied(false), 2000);
		} catch (err) {
			console.error("Failed to copy token:", err);
			setCopyError(true);
			setTimeout(() => setCopyError(false), 3000);
		}
	}, [token]);

	const handleOpenEditor = useCallback(() => {
		if (deepLinkUrl) {
			window.location.href = deepLinkUrl;
		}
	}, [deepLinkUrl]);

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
						className="w-full"
						onClick={() => {
							window.location.href = "/sign-in";
						}}
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
						className="w-full"
						onClick={() => {
							window.location.href = "/sign-in";
						}}
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
							className="w-full"
							onClick={handleOpenEditor}
							variant="outline"
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
						<p className="text-center text-muted-foreground text-sm">
							Copy this token and paste it in the extension:
						</p>
						<div className="flex gap-2">
							<Input
								className="font-mono text-xs"
								readOnly
								type="text"
								value={token}
							/>
							<Button
								className="shrink-0"
								onClick={handleCopy}
								size="icon"
								variant="outline"
							>
								{copied ? (
									<CheckCircle2 className="size-4 text-green-500" />
								) : copyError ? (
									<AlertCircle className="size-4 text-destructive" />
								) : (
									<Copy className="size-4" />
								)}
							</Button>
						</div>
						{copyError && (
							<p className="text-center text-destructive text-xs">
								Failed to copy. Please select and copy manually.
							</p>
						)}
					</div>
				) : (
					<button
						className="flex w-full items-center justify-center gap-1 py-2 text-muted-foreground text-sm transition-colors hover:text-foreground"
						onClick={() => setShowToken(true)}
						type="button"
					>
						<ChevronDown className="size-4" />
						Show token manually
					</button>
				)}
			</CardContent>
		</Card>
	);
}
