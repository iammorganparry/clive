/**
 * PasteableInput Component
 * Input field with explicit clipboard paste support
 * Handles bracketed paste mode for reliable copy/paste
 */

import type { InputRenderable } from "@opentui/core";
import { useEffect, useRef } from "react";

interface PasteableInputProps {
  placeholder?: string;
  focused?: boolean;
  onInput?: (value: string) => void;
  onSubmit?: (value: string) => void;
  style?: Record<string, any>;
}

export function PasteableInput({
  placeholder,
  focused = true,
  onInput,
  onSubmit,
  style,
}: PasteableInputProps) {
  const inputRef = useRef<InputRenderable>(null);

  // Enable bracketed paste mode
  useEffect(() => {
    if (!process.stdout.isTTY) return;

    // Enable bracketed paste mode
    // This makes terminals send pasted text between \x1b[200~ and \x1b[201~
    process.stdout.write("\x1b[?2004h");

    return () => {
      // Disable bracketed paste mode on unmount
      if (process.stdout.isTTY) {
        process.stdout.write("\x1b[?2004l");
      }
    };
  }, []);

  // Handle paste detection
  useEffect(() => {
    if (!focused || !inputRef.current) return;

    let pasteBuffer = "";
    let inPasteMode = false;

    const handleData = (data: Buffer) => {
      const str = data.toString();

      // Detect bracketed paste start
      if (str.includes("\x1b[200~")) {
        inPasteMode = true;
        pasteBuffer = "";
        return;
      }

      // Detect bracketed paste end
      if (str.includes("\x1b[201~")) {
        inPasteMode = false;
        if (pasteBuffer && inputRef.current) {
          // Insert pasted text
          inputRef.current.insertText(pasteBuffer);
          const newValue = inputRef.current.value;
          onInput?.(newValue);
        }
        pasteBuffer = "";
        return;
      }

      // Accumulate paste buffer
      if (inPasteMode) {
        pasteBuffer += str;
      }
    };

    process.stdin.on("data", handleData);

    return () => {
      process.stdin.removeListener("data", handleData);
    };
  }, [focused, onInput]);

  return (
    <input
      ref={inputRef}
      placeholder={placeholder}
      focused={focused}
      onInput={onInput}
      onSubmit={onSubmit}
      style={style}
    />
  );
}
