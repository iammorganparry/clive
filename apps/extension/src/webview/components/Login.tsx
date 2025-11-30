import { useState } from "react";
import { LoginForm } from "@clive/ui";
import { Effect, Runtime, pipe, type Layer } from "effect";
import { AuthServiceTag } from "../services/auth-service.js";

interface LoginProps {
  onLoginSuccess: () => void;
  layer: Layer.Layer<AuthServiceTag>;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess, layer }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGitHubLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await Runtime.runPromise(Runtime.defaultRuntime)(
        pipe(
          Effect.gen(function* () {
            const authService = yield* AuthServiceTag;
            yield* authService.startGitHubOAuth();
          }),
          Effect.provide(layer),
        ),
      );
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-full p-6">
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
