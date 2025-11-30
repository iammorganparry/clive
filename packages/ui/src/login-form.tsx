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
	FieldLabel,
	FieldSeparator,
} from "./field";
import { Input } from "./input";

export interface LoginFormProps extends React.ComponentProps<"div"> {
	onGitHubLogin?: () => void | Promise<void>;
	onEmailLogin?: (email: string, password: string) => void | Promise<void>;
	isLoading?: boolean;
	error?: string | null;
}

export function LoginForm({
	className,
	onGitHubLogin,
	onEmailLogin,
	isLoading = false,
	error,
	...props
}: LoginFormProps) {
	const [email, setEmail] = React.useState("");
	const [password, setPassword] = React.useState("");

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (onEmailLogin && email && password) {
			await onEmailLogin(email, password);
		}
	};

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<Card>
				<CardHeader className="text-center">
					<CardTitle className="text-xl">Welcome back</CardTitle>
					<CardDescription>
						Login with your GitHub account or email
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit}>
						<FieldGroup>
							<Field>
								<Button
									variant="outline"
									type="button"
									onClick={onGitHubLogin}
									disabled={isLoading}
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										className="size-4"
										aria-label="GitHub"
									>
										<title>GitHub</title>
										<path
											d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
											fill="currentColor"
										/>
									</svg>
									Login with GitHub
								</Button>
							</Field>
							<FieldSeparator className="*:data-[slot=field-separator-content]:bg-card">
								Or continue with
							</FieldSeparator>
							{error && (
								<Field>
									<div className="text-destructive text-sm">{error}</div>
								</Field>
							)}
							<Field>
								<FieldLabel htmlFor="email">Email</FieldLabel>
								<Input
									id="email"
									type="email"
									placeholder="m@example.com"
									value={email}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setEmail(e.target.value)
									}
									required
									disabled={isLoading}
								/>
							</Field>
							<Field>
								<div className="flex items-center">
									<FieldLabel htmlFor="password">Password</FieldLabel>
									<button
										type="button"
										className="ml-auto text-sm underline-offset-4 hover:underline"
										onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
											e.preventDefault();
										}}
									>
										Forgot your password?
									</button>
								</div>
								<Input
									id="password"
									type="password"
									value={password}
									onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
										setPassword(e.target.value)
									}
									required
									disabled={isLoading}
								/>
							</Field>
							<Field>
								<Button type="submit" disabled={isLoading}>
									{isLoading ? "Logging in..." : "Login"}
								</Button>
								<FieldDescription className="text-center">
									Don&apos;t have an account?{" "}
									<button type="button" className="underline">
										Sign up
									</button>
								</FieldDescription>
							</Field>
						</FieldGroup>
					</form>
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
