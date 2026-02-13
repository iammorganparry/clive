/**
 * WorkerConfigFlow Component
 * Interactive flow for configuring Slack worker integration
 * Collects central service URL and worker token, validates, and saves to config
 */

import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useEffect, useRef, useState } from "react";
import WebSocket from "ws";
import { usePaste } from "../hooks/usePaste";
import { OneDarkPro } from "../styles/theme";
import type { WorkerConfig } from "../types/views";
import { LoadingSpinner } from "./LoadingSpinner";

interface WorkerConfigFlowProps {
  width: number;
  height: number;
  /** Existing worker config if already configured */
  existingConfig?: WorkerConfig;
  /** Called when config is saved */
  onComplete: (config: WorkerConfig) => void;
  /** Called when user cancels the flow */
  onCancel: () => void;
}

type Step =
  | "intro"
  | "url"
  | "token"
  | "testing"
  | "success"
  | "error";

const DEFAULT_CENTRAL_URL = "wss://slack-central-production.up.railway.app/ws";

export function WorkerConfigFlow({
  width,
  height,
  existingConfig,
  onComplete,
  onCancel,
}: WorkerConfigFlowProps) {
  const [step, setStep] = useState<Step>(existingConfig ? "intro" : "intro");
  const [centralUrl, setCentralUrl] = useState(
    existingConfig?.centralUrl || DEFAULT_CENTRAL_URL,
  );
  const [token, setToken] = useState(existingConfig?.token || "");
  const [error, setError] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [introSelectedIndex, setIntroSelectedIndex] = useState(0);
  const inputRef = useRef<InputRenderable>(null);

  // Intro options
  const introOptions = existingConfig?.enabled
    ? [
        {
          id: "disable",
          label: "Disable Worker Mode",
          description: "Stop receiving Slack requests",
        },
        {
          id: "reconfigure",
          label: "Reconfigure",
          description: "Update connection settings",
        },
        { id: "cancel", label: "Keep Current", description: "No changes" },
      ]
    : [
        {
          id: "enable",
          label: "Enable Worker Mode",
          description: "Receive Slack interview requests",
        },
        {
          id: "cancel",
          label: "Cancel",
          description: "Return to previous screen",
        },
      ];

  // Handle keyboard events
  useKeyboard((event) => {
    if (event.name === "escape") {
      onCancel();
      return;
    }

    // Intro screen navigation
    if (step === "intro") {
      if (event.name === "up" || event.sequence === "k") {
        setIntroSelectedIndex((prev) =>
          prev > 0 ? prev - 1 : introOptions.length - 1,
        );
      } else if (event.name === "down" || event.sequence === "j") {
        setIntroSelectedIndex((prev) =>
          prev < introOptions.length - 1 ? prev + 1 : 0,
        );
      } else if (event.name === "return") {
        const option = introOptions[introSelectedIndex];
        if (option) handleIntroSelect(option.id);
      } else if (event.sequence && /^[1-9]$/.test(event.sequence)) {
        const index = parseInt(event.sequence, 10) - 1;
        const option = introOptions[index];
        if (option && index < introOptions.length) {
          handleIntroSelect(option.id);
        }
      }
    }

    // Error step - retry on Enter
    if (step === "error" && event.name === "return") {
      setError("");
      setStep("testing");
    }
  });

  // Handle paste events for URL and token input
  usePaste((event) => {
    if ((step === "url" || step === "token") && inputRef.current) {
      if (event.text) {
        inputRef.current.insertText(event.text);
        setInputValue(inputRef.current.value);
      }
    }
  });

  const handleIntroSelect = (optionId: string) => {
    switch (optionId) {
      case "enable":
      case "reconfigure":
        setInputValue(centralUrl);
        setStep("url");
        break;
      case "disable":
        onComplete({
          enabled: false,
          centralUrl: existingConfig?.centralUrl || DEFAULT_CENTRAL_URL,
          token: existingConfig?.token || "",
          autoConnect: false,
        });
        break;
      case "cancel":
        onCancel();
        break;
    }
  };

  const handleUrlSubmit = () => {
    if (!inputValue.trim()) {
      setError("Central service URL is required");
      return;
    }

    // Validate URL format
    try {
      new URL(inputValue);
    } catch {
      setError("Invalid URL format");
      return;
    }

    setCentralUrl(inputValue);
    setError("");
    // Check if token is available from environment
    const envToken = process.env.CLIVE_WORKER_TOKEN;
    if (envToken) {
      setToken(envToken);
      setStep("testing");
    } else {
      setInputValue(token || "");
      setStep("token");
    }
  };

  const handleTokenSubmit = () => {
    if (!inputValue.trim()) {
      setError("Worker token is required");
      return;
    }
    setToken(inputValue.trim());
    setError("");
    setStep("testing");
  };

  // Test connection when entering testing step
  useEffect(() => {
    if (step !== "testing") return;

    let ws: WebSocket | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const testConnection = async () => {
      try {
        ws = new WebSocket(centralUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        timeout = setTimeout(() => {
          if (ws) {
            ws.close();
          }
          setError("Connection timed out");
          setStep("error");
        }, 10000);

        ws.on("open", () => {
          if (timeout) clearTimeout(timeout);
          // Connection successful
          ws?.close();
          setStep("success");
          // Auto-complete after showing success
          setTimeout(() => {
            onComplete({
              enabled: true,
              centralUrl,
              token,
              autoConnect: true,
            });
          }, 1500);
        });

        ws.on("error", (err) => {
          if (timeout) clearTimeout(timeout);
          setError(err.message || "Connection failed");
          setStep("error");
        });
      } catch (err) {
        if (timeout) clearTimeout(timeout);
        setError((err as Error).message || "Connection failed");
        setStep("error");
      }
    };

    testConnection();

    return () => {
      if (timeout) clearTimeout(timeout);
      if (ws) {
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
    };
  }, [step, centralUrl, token, onComplete]);

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.primary}
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
    >
      <box flexDirection="column" alignItems="center" width={70}>
        {/* Header */}
        <box flexDirection="row" marginBottom={2}>
          <text fg={OneDarkPro.syntax.red}>
            <b>CLIVE</b>
          </text>
          <text fg={OneDarkPro.foreground.muted}>
            {" · Slack Worker Setup"}
          </text>
        </box>

        {/* Step: Intro */}
        {step === "intro" && (
          <>
            <text fg={OneDarkPro.foreground.secondary} marginTop={1}>
              Worker mode allows you to receive interview requests from Slack.
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              When enabled, @clive mentions in Slack will route to this
              terminal.
            </text>

            {existingConfig?.enabled && (
              <box
                marginTop={2}
                padding={1}
                backgroundColor={OneDarkPro.background.secondary}
              >
                <text fg={OneDarkPro.syntax.green}>
                  Worker mode is currently enabled
                </text>
              </box>
            )}

            <box marginTop={3} flexDirection="column" width={60}>
              <text fg={OneDarkPro.foreground.primary} marginBottom={1}>
                What would you like to do?
              </text>
              {introOptions.map((option, i) => {
                const isSelected = i === introSelectedIndex;
                return (
                  <box
                    key={option.id}
                    backgroundColor={
                      isSelected
                        ? OneDarkPro.background.highlight
                        : "transparent"
                    }
                    padding={1}
                    marginBottom={1}
                  >
                    <text
                      fg={
                        isSelected
                          ? OneDarkPro.syntax.blue
                          : OneDarkPro.foreground.primary
                      }
                    >
                      {isSelected ? (
                        <b>{"> "}{i + 1}. {option.label}</b>
                      ) : (
                        <>{"  "}{i + 1}. {option.label}</>
                      )}
                    </text>
                    <text fg={OneDarkPro.foreground.muted}>
                      {"   "}
                      {option.description}
                    </text>
                  </box>
                );
              })}
            </box>
          </>
        )}

        {/* Step: URL */}
        {step === "url" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Central Service URL:
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Usually: {DEFAULT_CENTRAL_URL}
            </text>

            <box
              marginTop={2}
              width={60}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
            >
              <input
                ref={inputRef}
                placeholder={DEFAULT_CENTRAL_URL}
                focused={true}
                onInput={setInputValue}
                onSubmit={handleUrlSubmit}
                value={inputValue}
                style={{
                  textColor: OneDarkPro.foreground.primary,
                  backgroundColor: OneDarkPro.background.secondary,
                  focusedBackgroundColor: OneDarkPro.background.secondary,
                }}
              />
            </box>

            {error && (
              <text fg={OneDarkPro.syntax.red} marginTop={1}>
                {error}
              </text>
            )}
          </>
        )}

        {/* Step: Token Input */}
        {step === "token" && (
          <>
            <text fg={OneDarkPro.foreground.primary} marginTop={2}>
              Worker Token:
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Paste the CLIVE_WORKER_TOKEN shared with the central service
            </text>

            <box
              marginTop={2}
              width={60}
              padding={1}
              backgroundColor={OneDarkPro.background.secondary}
            >
              <input
                ref={inputRef}
                placeholder="Paste worker token here..."
                focused={true}
                onInput={setInputValue}
                onSubmit={handleTokenSubmit}
                value={inputValue}
                style={{
                  textColor: OneDarkPro.foreground.primary,
                  backgroundColor: OneDarkPro.background.secondary,
                  focusedBackgroundColor: OneDarkPro.background.secondary,
                }}
              />
            </box>

            {error && (
              <text fg={OneDarkPro.syntax.red} marginTop={1}>
                {error}
              </text>
            )}
          </>
        )}

        {/* Step: Testing */}
        {step === "testing" && (
          <box marginTop={4}>
            <LoadingSpinner
              text="Testing connection to central service..."
              color={OneDarkPro.syntax.yellow}
            />
          </box>
        )}

        {/* Step: Success */}
        {step === "success" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.syntax.green}>
              Connection successful!
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              Worker mode is now enabled. You'll receive Slack requests here.
            </text>
          </box>
        )}

        {/* Step: Error */}
        {step === "error" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.syntax.red}>
              Connection failed
            </text>
            <text fg={OneDarkPro.foreground.muted} marginTop={1}>
              {error}
            </text>

            <box marginTop={3} flexDirection="row">
              <box
                padding={1}
                backgroundColor={OneDarkPro.background.secondary}
                marginRight={2}
              >
                <text fg={OneDarkPro.syntax.blue}>Press Enter to retry</text>
              </box>
              <box
                padding={1}
                backgroundColor={OneDarkPro.background.secondary}
              >
                <text fg={OneDarkPro.foreground.muted}>
                  Press Esc to cancel
                </text>
              </box>
            </box>
          </box>
        )}

        {/* Instructions */}
        {step === "intro" && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              1-{introOptions.length} Select | Up/Down Navigate | Enter Confirm
              | Esc Cancel
            </text>
          </box>
        )}

        {(step === "url" || step === "token") && (
          <box marginTop={4} flexDirection="column" alignItems="center">
            <text fg={OneDarkPro.foreground.secondary}>
              Enter Submit | Esc Cancel
            </text>
          </box>
        )}
      </box>
    </box>
  );
}
