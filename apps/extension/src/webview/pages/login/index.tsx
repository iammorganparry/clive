import { useState, useEffect } from "react";
import { LoginForm, DeviceAuthPending } from "@clive/ui";
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
import { useRouter } from "../../router/index.js";

export const LoginPage: React.FC = () => {
  const {
    login,
    isAuthenticated,
    setToken,
    deviceAuthState,
    isDeviceAuthPending,
    cancelDeviceAuth,
  } = useAuth();
  const { send } = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualToken, setManualToken] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

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

  const handleManualTokenSubmit = () => {
    if (!manualToken.trim()) {
      setError("Please enter a token");
      return;
    }
    setError(null);
    setToken(manualToken.trim());
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
