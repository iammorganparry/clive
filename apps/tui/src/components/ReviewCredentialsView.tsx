/**
 * ReviewCredentialsView Component
 * Credentials entry screen for Review Mode browser testing
 * Collects base URL, test email/password, and skip auth option
 */

import type { InputRenderable } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useCallback, useRef, useState } from "react";
import { usePaste } from "../hooks/usePaste";
import { OneDarkPro } from "../styles/theme";
import type { ReviewCredentials } from "../types/views";

interface ReviewCredentialsViewProps {
  width: number;
  height: number;
  credentials: ReviewCredentials;
  onSubmit: (credentials: ReviewCredentials) => void;
  onBack: () => void;
}

type FieldName = "baseUrl" | "email" | "password" | "skipAuth";

const FIELDS: FieldName[] = ["baseUrl", "email", "password", "skipAuth"];

export function ReviewCredentialsView({
  width,
  height,
  credentials,
  onSubmit,
  onBack,
}: ReviewCredentialsViewProps) {
  const [focusedField, setFocusedField] = useState<number>(0);
  const [baseUrl, setBaseUrl] = useState(
    credentials.baseUrl || "http://localhost:3000",
  );
  const [email, setEmail] = useState(credentials.email || "");
  const [password, setPassword] = useState(credentials.password || "");
  const [skipAuth, setSkipAuth] = useState(credentials.skipAuth || false);

  const baseUrlRef = useRef<InputRenderable>(null);
  const emailRef = useRef<InputRenderable>(null);
  const passwordRef = useRef<InputRenderable>(null);

  const getInputRef = useCallback((field: FieldName) => {
    switch (field) {
      case "baseUrl":
        return baseUrlRef;
      case "email":
        return emailRef;
      case "password":
        return passwordRef;
      default:
        return null;
    }
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit({
      baseUrl,
      email: email || undefined,
      password: password || undefined,
      skipAuth,
    });
  }, [baseUrl, email, password, skipAuth, onSubmit]);

  // Handle keyboard events
  useKeyboard((event) => {
    if (event.name === "escape") {
      onBack();
      return;
    }

    // Tab navigation between fields
    if (event.name === "tab") {
      if (event.shift) {
        // Shift+Tab - go backwards
        setFocusedField((prev) => (prev > 0 ? prev - 1 : FIELDS.length - 1));
      } else {
        // Tab - go forwards
        setFocusedField((prev) => (prev < FIELDS.length - 1 ? prev + 1 : 0));
      }
      return;
    }

    // Enter to submit (if not on checkbox)
    if (event.name === "return") {
      const currentField = FIELDS[focusedField];
      if (currentField === "skipAuth") {
        // Toggle checkbox
        setSkipAuth((prev) => !prev);
      } else {
        // Submit form
        handleSubmit();
      }
      return;
    }

    // Space to toggle checkbox when focused on skipAuth
    if (event.sequence === " " && FIELDS[focusedField] === "skipAuth") {
      setSkipAuth((prev) => !prev);
      return;
    }
  });

  // Handle paste events
  usePaste((event) => {
    const currentField = FIELDS[focusedField];
    const ref = getInputRef(currentField);
    if (ref?.current && event.text) {
      ref.current.insertText(event.text);
      // Update state to match
      switch (currentField) {
        case "baseUrl":
          setBaseUrl(ref.current.value);
          break;
        case "email":
          setEmail(ref.current.value);
          break;
        case "password":
          setPassword(ref.current.value);
          break;
      }
    }
  });

  const renderInputField = (
    label: string,
    field: FieldName,
    value: string,
    onChange: (val: string) => void,
    ref: React.RefObject<InputRenderable | null>,
    placeholder: string,
    isPassword = false,
  ) => {
    const isFocused = FIELDS[focusedField] === field;

    return (
      <box flexDirection="column" marginBottom={1}>
        <text
          fg={isFocused ? OneDarkPro.syntax.blue : OneDarkPro.foreground.muted}
          marginBottom={1}
        >
          {label}
        </text>
        <box
          width={45}
          height={1}
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={OneDarkPro.background.secondary}
          borderStyle="rounded"
          borderColor={
            isFocused ? OneDarkPro.syntax.green : OneDarkPro.ui.border
          }
        >
          <input
            ref={ref}
            placeholder={placeholder}
            focused={isFocused}
            onInput={onChange}
            value={isPassword ? "*".repeat(value.length) : value}
            style={{
              fg: OneDarkPro.foreground.primary,
              backgroundColor: OneDarkPro.background.secondary,
              focusedBackgroundColor: OneDarkPro.background.secondary,
            }}
          />
        </box>
      </box>
    );
  };

  const renderCheckbox = () => {
    const isFocused = FIELDS[focusedField] === "skipAuth";

    return (
      <box flexDirection="row" alignItems="center" marginTop={1}>
        <box
          width={3}
          height={1}
          borderStyle="rounded"
          borderColor={
            isFocused ? OneDarkPro.syntax.green : OneDarkPro.ui.border
          }
          backgroundColor={OneDarkPro.background.secondary}
          justifyContent="center"
          alignItems="center"
        >
          <text
            fg={
              skipAuth ? OneDarkPro.syntax.green : OneDarkPro.foreground.muted
            }
          >
            {skipAuth ? "x" : " "}
          </text>
        </box>
        <text
          fg={
            isFocused ? OneDarkPro.syntax.blue : OneDarkPro.foreground.primary
          }
          marginLeft={2}
        >
          Skip authentication (public app)
        </text>
      </box>
    );
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
      <box flexDirection="column" alignItems="center" width={55}>
        {/* Header */}
        <box flexDirection="row" marginBottom={3}>
          <text fg={OneDarkPro.syntax.red} bold>
            CLIVE
          </text>
          <text fg={OneDarkPro.foreground.muted}>{" · Review Setup"}</text>
        </box>

        {/* Description */}
        <text fg={OneDarkPro.foreground.secondary} marginBottom={3}>
          Configure credentials for browser testing
        </text>

        {/* Form Fields */}
        <box flexDirection="column" width={50}>
          {renderInputField(
            "App Base URL",
            "baseUrl",
            baseUrl,
            setBaseUrl,
            baseUrlRef,
            "http://localhost:3000",
          )}

          {renderInputField(
            "Test Email (optional)",
            "email",
            email,
            setEmail,
            emailRef,
            "test@example.com",
          )}

          {renderInputField(
            "Test Password (optional)",
            "password",
            password,
            setPassword,
            passwordRef,
            "password",
            true,
          )}

          {renderCheckbox()}
        </box>

        {/* Keyboard Hints */}
        <box marginTop={4} flexDirection="column" alignItems="center">
          <text fg={OneDarkPro.foreground.muted}>
            Tab Navigate {"\u00B7"} Enter Continue {"\u00B7"} Esc Back
          </text>
        </box>
      </box>
    </box>
  );
}
