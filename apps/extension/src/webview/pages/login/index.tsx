import { useState, useEffect } from "react";
import { LoginForm } from "@clive/ui";
import { Button } from "@clive/ui/button";
import { Input } from "@clive/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@clive/ui/card";
import { Field, FieldGroup } from "@clive/ui/field";
import { useAuth } from "../../contexts/auth-context.js";
import { useRouter, Routes } from "../../router/index.js";

export const LoginPage: React.FC = () => {
  const {
    login,
    isLoading: authLoading,
    isAuthenticated,
    setToken,
  } = useAuth();
  const { navigate } = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  // Monitor authentication state - when user becomes authenticated, navigate to dashboard
  useEffect(() => {
    if (isAuthenticated && !authLoading) {
      navigate(Routes.dashboard);
    }
  }, [isAuthenticated, authLoading, navigate]);

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

  const handleManualTokenSubmit = () => {
    if (!manualToken.trim()) {
      setError("Please enter a token");
      return;
    }
    setError(null);
    setToken(manualToken.trim());
  };

  // Show loading state while auth is initializing
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-screen p-6">
        <div className="w-full max-w-md">
          <LoginForm
            onGitHubClick={() => {
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
      <div className="w-full max-w-md space-y-4">
        <LoginForm
          onGitHubClick={handleGitHubLogin}
          isLoading={isLoading}
          error={error}
        />
        <Card className="p-2 border-none">
          <CardHeader className="text-center">
            <CardTitle className="text-lg">Or enter token manually</CardTitle>
            <CardDescription>
              For testing purposes, you can paste a token directly
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {showManualInput ? (
                <>
                  <Field>
                    <Input
                      type="text"
                      placeholder="Paste your authentication token here"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      className="font-mono text-sm"
                    />
                  </Field>
                  <Field>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleManualTokenSubmit}
                        className="flex-1"
                        disabled={!manualToken.trim()}
                      >
                        Submit Token
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowManualInput(false);
                          setManualToken("");
                          setError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </Field>
                </>
              ) : (
                <Field>
                  <Button
                    variant="ghost"
                    onClick={() => setShowManualInput(true)}
                    className="w-full"
                  >
                    Enter Token Manually
                  </Button>
                </Field>
              )}
            </FieldGroup>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
