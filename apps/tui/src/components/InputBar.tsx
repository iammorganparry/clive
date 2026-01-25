/**
 * InputBar Component
 * Command input field at bottom of screen
 */

import type { InputRenderable } from "@opentui/core";
import { useRef, useState } from "react";
import { usePaste } from "../hooks/usePaste";
import { OneDarkPro } from "../styles/theme";

interface InputBarProps {
  width: number;
  height: number;
  y: number;
  onSubmit: (command: string) => void;
  disabled?: boolean;
}

export function InputBar({
  width,
  height,
  y,
  onSubmit,
  disabled = false,
}: InputBarProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<InputRenderable>(null);

  // Handle paste events
  usePaste((event) => {
    if (!disabled && inputRef.current && event.text) {
      // Debug: log the paste event
      console.log("InputBar paste event:", event);
      console.log("InputBar paste text:", event.text);
      console.log("InputBar paste text length:", event.text.length);

      // Use InputRenderable's insertText method directly
      inputRef.current.insertText(event.text);
      // Update our state to match
      setInput(inputRef.current.value);
    }
  });

  const handleSubmit = () => {
    if (input.trim() && !disabled) {
      onSubmit(input);
      setInput("");
    }
  };

  return (
    <box
      y={y}
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      // borderStyle causes Bun FFI crash - removed
      // borderColor={OneDarkPro.ui.border}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
    >
      <box flexDirection="row">
        <text fg={OneDarkPro.syntax.cyan}>{"> "}</text>
        <input
          ref={inputRef}
          placeholder={
            disabled ? "Waiting for response..." : "Enter command (or /help)"
          }
          focused={!disabled}
          onInput={setInput}
          onSubmit={handleSubmit}
          value={input}
          style={{
            width: width - 4,
            fg: OneDarkPro.foreground.primary,
            backgroundColor: OneDarkPro.background.secondary,
            focusedBackgroundColor: OneDarkPro.background.secondary,
          }}
        />
      </box>
    </box>
  );
}
