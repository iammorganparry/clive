import { useState, useEffect } from "react";
import { LoginForm } from "@clive/ui";
import { useAuth } from "../contexts/AuthContext.js";

interface LoginProps {
	onLoginSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
	const { login, isLoading: authLoading, isAuthenticated } = useAuth();
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Monitor authentication state - when user becomes authenticated, call onLoginSuccess
	useEffect(() => {
		if (isAuthenticated && !authLoading) {
			onLoginSuccess();
		}
	}, [isAuthenticated, authLoading, onLoginSuccess]);

	const handleGitHubLogin = async () => {
		setIsLoading(true);
		setError(null);

		try {
			// Open browser to login page - extension will handle opening browser
			await login();
			// Note: The login() function opens the browser, but doesn't wait for completion
			// The token will be received via message from extension when callback completes
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : "Failed to sign in with GitHub";
			setError(errorMessage);
			console.error("GitHub sign-in error:", err);
			setIsLoading(false);
		}
	};

	// Show loading state while auth is initializing
	if (authLoading) {
		return (
			<div className="flex items-center justify-center h-screen p-6">
				<div className="w-full max-w-md">
					<LoginForm
						onGitHubLogin={() => {
							// Loading state - button disabled
						}}
						isLoading={true}
						error={null}
					/>
				</div>
			</div>
		);
	}

	return (
		<div className="flex items-center justify-center h-screen p-6">
			<div className="w-full max-w-md">
				<LoginForm
					onGitHubLogin={handleGitHubLogin}
					isLoading={isLoading}
					error={error}
				/>
			</div>
		</div>
	);
};
