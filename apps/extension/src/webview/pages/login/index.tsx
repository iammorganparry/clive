import { DeviceAuthPending, LoginForm } from "@clive/ui";
import { useEffect, useState } from "react";
import { useAuth } from "../../contexts/auth-context.js";
import { useRouter } from "../../router/index.js";

export const LoginPage: React.FC = () => {
  const {
    login,
    isAuthenticated,
    deviceAuthState,
    isDeviceAuthPending,
    cancelDeviceAuth,
  } = useAuth();
  const { send } = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When user becomes authenticated, send LOGIN_SUCCESS to trigger onboarding check
  useEffect(() => {
    if (isAuthenticated) {
      send({ type: "LOGIN_SUCCESS" });
    }
  }, [isAuthenticated, send]);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    setError(null);

    try {
      await login();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to start sign in";
      setError(errorMessage);
      console.error("Sign-in error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    cancelDeviceAuth();
    setIsLoading(false);
  };

  // Show device auth pending state
  if (isDeviceAuthPending && deviceAuthState) {
    return (
      <DeviceAuthPending
        userCode={deviceAuthState.userCode}
        verificationUri={deviceAuthState.verificationUriComplete}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div className="flex items-center justify-center h-screen p-6">
      <div className="w-full max-w-md space-y-4">
        <LoginForm
          onGitHubClick={handleGitHubLogin}
          isLoading={isLoading}
          error={error}
        />
      </div>
    </div>
  );
};
