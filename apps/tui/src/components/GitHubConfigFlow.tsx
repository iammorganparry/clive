/**
 * GitHubConfigFlow Component
 * Interactive flow for configuring GitHub integration
 * Collects GitHub token and validates
 */

import { useKeyboard } from "@opentui/react";
import { useState } from "react";
import { OneDarkPro } from "../styles/theme";
import { LoadingSpinner } from "./LoadingSpinner";

interface GitHubConfigFlowProps {
  width: number;
  height: number;
  onComplete: (config: { token: string }) => void;
  onCancel: () => void;
}

type Step = "token" | "validating" | "success";

export function GitHubConfigFlow({
  width,
  height,
  onComplete,
  onCancel,
}: GitHubConfigFlowProps) {
  const [step, setStep] = useState<Step>("token");
  const [_token, setToken] = useState("");
  const [error, setError] = useState("");
  const [inputValue, setInputValue] = useState("");

  // Handle keyboard input
  useKeyboard((event) => {
    if (event.name === "escape") {
      onCancel();
      return;
    }

    if (step === "token") {
      if (event.name === "return") {
        handleSubmit();
      } else if (event.name === "backspace") {
        setInputValue((prev) => prev.slice(0, -1));
      } else if (event.sequence && event.sequence.length === 1) {
        setInputValue((prev) => prev + event.sequence);
      }
    }
  });

  const handleSubmit = async () => {
    if (!inputValue.trim()) {
      setError("GitHub token is required");
      return;
    }

    setError("");
    setToken(inputValue);
    setStep("validating");

    // Validate token
    try {
      await validateGitHubToken(inputValue);
      setStep("success");
      setTimeout(() => {
        onComplete({ token: inputValue });
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed");
      setStep("token");
      setInputValue("");
    }
  };

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <box flexDirection="column" alignItems="center" width={60}>
        {/* Header */}
        <box flexDirection="row" marginBottom={2}>
          <text fg={OneDarkPro.syntax.red}>
            <b>CLIVE</b>
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · GitHub Setup"}</text>
        </box>

        {/* Step: Token */}
        {step === "token" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Enter your GitHub personal access token:
            </text>

            <box
              marginTop={2}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
              width={50}
            >
              <text fg={OneDarkPro.foreground.primary}>
                {inputValue ? "•".repeat(Math.min(inputValue.length, 40)) : "_"}
              </text>
            </box>

            {error && (
              <text fg={OneDarkPro.syntax.red} marginTop={1}>
                {error}
              </text>
            )}

            <box marginTop={2} flexDirection="column" alignItems="center">
              <text fg={OneDarkPro.foreground.muted}>Create a token at:</text>
              <text fg={OneDarkPro.syntax.blue} marginTop={1}>
                https://github.com/settings/tokens
              </text>
              <text fg={OneDarkPro.foreground.muted} marginTop={1}>
                Required scopes: repo, read:org
              </text>
            </box>
          </>
        )}

        {/* Step: Validating */}
        {step === "validating" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Validating token..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.syntax.green}>
              ✓ GitHub configured successfully!
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Starting Clive...
            </text>
          </box>
        )}

        {/* Instructions */}
        {step === "token" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              Enter Submit • Esc Cancel
            </text>
          </box>
        )}
      </box>
    </box>
  );
}

/**
 * Validate GitHub personal access token
 */
async function validateGitHubToken(token: string): Promise<void> {
  // Simulate API call delay
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // In real implementation:
  // 1. Make request to GitHub API with token
  // 2. Verify token has required scopes
  // 3. Save to config file (~/.clive/config.json)

  if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
    throw new Error("Invalid GitHub token format");
  }
}
