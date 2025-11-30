import * as React from "react";
import { cn } from "./lib/utils";
import { Button } from "./button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "./card";
import {
	Field,
	FieldDescription,
	FieldGroup,
} from "./field";
import { GitHubLogoIcon } from "@radix-ui/react-icons";

export interface LoginFormProps extends React.ComponentProps<"div"> {
	onGitHubLogin?: () => void | Promise<void>;
	isLoading?: boolean;
	error?: string | null;
}

export function LoginForm({
	className,
	onGitHubLogin,
	isLoading = false,
	error,
	...props
}: LoginFormProps) {

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<Card className="p-2 border-none">
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>
						Login with your GitHub account
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FieldGroup>
						<Field>
							<Button
								variant="outline"
								type="button"
								onClick={onGitHubLogin}
								disabled={isLoading}
								className="w-full"
							>
								<GitHubLogoIcon />
								Login with GitHub
							</Button>
						</Field>
						{error && (
							<Field>
								<div className="text-destructive text-sm">{error}</div>
							</Field>
						)}
					</FieldGroup>
				</CardContent>
			</Card>
			<FieldDescription className="px-6 text-center">
				By clicking continue, you agree to our{" "}
				<button type="button" className="underline">
					Terms of Service
				</button>{" "}
				and{" "}
				<button type="button" className="underline">
					Privacy Policy
				</button>
				.
			</FieldDescription>
		</div>
	);
}
