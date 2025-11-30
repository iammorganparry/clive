import { redirect } from "next/navigation";

import { Button } from "@clive/ui/button";
import { SignInButton, SignOutButton, UserButton } from "@clerk/nextjs";

import { auth } from "~/auth/server";

export async function AuthShowcase() {
	const { userId } = await auth();

	if (!userId) {
		return (
			<div className="flex flex-col items-center justify-center gap-4">
				<SignInButton mode="modal">
					<Button size="lg">Sign in</Button>
				</SignInButton>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center justify-center gap-4">
			<p className="text-center text-2xl">
				<span>Logged in</span>
			</p>
			<div className="flex items-center gap-4">
				<UserButton />
				<SignOutButton>
					<Button size="lg">Sign out</Button>
				</SignOutButton>
			</div>
		</div>
	);
}
