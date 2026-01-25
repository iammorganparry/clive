"use client";

import { DeviceCodeEntry } from "@clive/ui";
import { Card, CardContent } from "@clive/ui/card";
import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

function DevicePageContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const initialCode = searchParams.get("user_code")?.toUpperCase() ?? "";

	const handleVerify = async (code: string) => {
		const formattedCode = code.toUpperCase();

		const response = await fetch(`/api/auth/device?user_code=${formattedCode}`);

		if (!response.ok) {
			const data = await response.json();
			throw new Error(data.message ?? "Invalid or expired code");
		}

		router.push(`/device/approve?user_code=${formattedCode}`);
	};

	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<DeviceCodeEntry
				autoSubmit={true}
				initialCode={initialCode}
				onSubmit={handleVerify}
			/>
		</div>
	);
}

function DevicePageFallback() {
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardContent className="flex flex-col items-center justify-center py-16">
					<Loader2 className="size-8 animate-spin text-primary" />
					<p className="mt-4 text-muted-foreground text-sm">Loading...</p>
				</CardContent>
			</Card>
		</div>
	);
}

export default function DevicePage() {
	return (
		<Suspense fallback={<DevicePageFallback />}>
			<DevicePageContent />
		</Suspense>
	);
}
