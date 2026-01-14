import { Box, Text, useFocus, useInput } from "ink";
import TextInput from "ink-text-input";
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useTheme } from "../theme.js";

interface CommandInputProps {
  onSubmit: (input: string) => void;
  onFocusChange?: (isFocused: boolean) => void;
  placeholder?: string;
}

export interface CommandInputHandle {
  focus: () => void;
}

const COMMAND_INPUT_ID = "command-input";

export const CommandInput = forwardRef<CommandInputHandle, CommandInputProps>(
  ({ onSubmit, onFocusChange, placeholder = "Type /help for commands..." }, ref) => {
    const theme = useTheme();
    const [value, setValue] = useState("");
    const [history, setHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const { isFocused, focus } = useFocus({
      autoFocus: true,
      id: COMMAND_INPUT_ID,
    });

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => focus(COMMAND_INPUT_ID),
    }));

    // Track previous focus state to detect changes synchronously
    const prevFocusedRef = useRef<boolean | null>(null);

    // Notify parent of focus changes synchronously (no useEffect)
    if (prevFocusedRef.current !== isFocused) {
      prevFocusedRef.current = isFocused;
      if (onFocusChange) {
        queueMicrotask(() => onFocusChange(isFocused));
      }
    }

    useInput(
      (input, key) => {
        if (!isFocused) return;

        // Navigate history with up/down
        if (key.upArrow && history.length > 0) {
          const newIndex = Math.min(historyIndex + 1, history.length - 1);
          setHistoryIndex(newIndex);
          setValue(history[history.length - 1 - newIndex] || "");
        }
        if (key.downArrow && historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          setValue(history[history.length - 1 - newIndex] || "");
        }
        if (key.downArrow && historyIndex === 0) {
          setHistoryIndex(-1);
          setValue("");
        }

        // Clear on escape
        if (key.escape) {
          setValue("");
          setHistoryIndex(-1);
        }
      },
      { isActive: isFocused },
    );

    const handleSubmit = (submittedValue: string) => {
      const trimmed = submittedValue.trim();
      if (trimmed) {
        // Add to history
        setHistory((prev) => [...prev, trimmed]);
        setHistoryIndex(-1);

        // Pass raw input to handler - let parent decide what to do
        onSubmit(trimmed);
        setValue("");
      }
    };

    return (
      <Box
        borderStyle="round"
        borderColor={isFocused ? theme.syntax.blue : theme.ui.border}
        borderTop={false}
        borderBottom={false}
        paddingX={1}
      >
        <Text color={theme.syntax.blue} bold>
          &gt;{" "}
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={placeholder}
        />
      </Box>
    );
  },
);

CommandInput.displayName = "CommandInput";
