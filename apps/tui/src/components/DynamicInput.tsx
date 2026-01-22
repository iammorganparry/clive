import { useState, useRef, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { SuggestionsPanel, type CommandSuggestion } from './SuggestionsPanel';
import { QuestionPanel } from './QuestionPanel';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { usePaste } from '../hooks/usePaste';
import { OneDarkPro } from '../styles/theme';
import type { QuestionData } from '../types';

// Available commands
const COMMANDS: CommandSuggestion[] = [
  { cmd: '/plan', desc: 'Create a work plan (enter plan mode)' },
  { cmd: '/build', desc: 'Execute work plan (enter build mode)' },
  { cmd: '/exit', desc: 'Exit current mode' },
  { cmd: '/add', desc: 'Add task to epic (build mode)' },
  { cmd: '/cancel', desc: 'Cancel running process' },
  { cmd: '/clear', desc: 'Clear output' },
  { cmd: '/status', desc: 'Show current status' },
  { cmd: '/help', desc: 'Show help' },
];

interface DynamicInputProps {
  width: number;
  onSubmit: (command: string) => void;
  disabled?: boolean;
  isRunning?: boolean;
  inputFocused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  preFillValue?: string;
  pendingQuestion?: QuestionData | null;
  onQuestionAnswer?: (answers: Record<string, string>) => void;
  onQuestionCancel?: () => void;
  rawInputMode?: boolean; // When true, forward all keys directly to PTY
  onRawKeyPress?: (key: string) => void; // Handler for raw key events
}

export function DynamicInput({
  width,
  onSubmit,
  disabled = false,
  isRunning = false,
  inputFocused = false,
  onFocusChange,
  preFillValue,
  pendingQuestion = null,
  onQuestionAnswer,
  onQuestionCancel,
  rawInputMode = false,
  onRawKeyPress,
}: DynamicInputProps) {
  const [value, setValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const inputRef = useRef<any>(null);

  const commandHistory = useCommandHistory();

  // Handle pre-fill value (e.g., when "/" key is pressed to focus)
  useEffect(() => {
    if (preFillValue && inputFocused) {
      setValue(preFillValue);
    }
  }, [preFillValue, inputFocused]);

  // Filter suggestions based on input (disabled in raw input mode)
  const filteredSuggestions = !rawInputMode && value.startsWith('/') && !value.includes(' ')
    ? COMMANDS.filter((c) => c.cmd.startsWith(value))
    : [];

  // Show suggestions when typing "/" commands (disabled in raw input mode)
  useEffect(() => {
    if (!rawInputMode && filteredSuggestions.length > 0 && inputFocused) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
      setSelectedSuggestion(0);
    }
  }, [filteredSuggestions.length, inputFocused, rawInputMode]);

  // Handle paste events
  usePaste((pasteEvent) => {
    if (!inputFocused) return;

    const text = pasteEvent.text;
    if (text && inputRef.current) {
      // Use insertText method as per OpenTUI docs
      inputRef.current.insertText(text);
    }
  });

  // Handle keyboard navigation for suggestions and command history
  // Regular character input is handled by the native input's onInput callback
  useKeyboard((event) => {
    // Only handle when input is focused
    if (!inputFocused) return;

    // RAW INPUT MODE: Forward all keys directly to PTY
    if (rawInputMode && onRawKeyPress) {
      // Map keys to appropriate sequences
      const keyMap: Record<string, string> = {
        'up': '\x1b[A',
        'down': '\x1b[B',
        'right': '\x1b[C',
        'left': '\x1b[D',
        'return': '\r',
        'escape': '\x1b',
        'tab': '\t',
        'backspace': '\x7f',
        'delete': '\x1b[3~',
      };

      const mappedKey = keyMap[event.name];
      if (mappedKey) {
        event.preventDefault?.();
        onRawKeyPress(mappedKey);
        return;
      }

      // For regular characters, forward as-is
      if (event.sequence) {
        event.preventDefault?.();
        onRawKeyPress(event.sequence);
        return;
      }
    }

    // Select all functionality (Ctrl+A / Cmd+A)
    if ((event.ctrl || event.meta) && event.name === 'a') {
      // Try to select all text if the input ref supports it
      if (inputRef.current) {
        // OpenTUI may support selectAll or setSelectionRange
        if (typeof inputRef.current.selectAll === 'function') {
          inputRef.current.selectAll();
        } else if (typeof inputRef.current.setSelectionRange === 'function' && value) {
          inputRef.current.setSelectionRange(0, value.length);
        }
      }
      return;
    }

    // Handle suggestion navigation when showing suggestions
    if (showSuggestions && filteredSuggestions.length > 0) {
      // Arrow up - previous suggestion
      if (event.name === 'up') {
        setSelectedSuggestion(Math.max(0, selectedSuggestion - 1));
        return;
      }

      // Arrow down - next suggestion
      if (event.name === 'down') {
        setSelectedSuggestion(
          Math.min(filteredSuggestions.length - 1, selectedSuggestion + 1)
        );
        return;
      }

      // Tab or Enter to accept suggestion when suggestions are showing
      if (event.name === 'tab' || event.name === 'return') {
        event.preventDefault?.(); // Prevent default behavior
        const suggestion = filteredSuggestions[selectedSuggestion];
        if (suggestion) {
          setValue(suggestion.cmd + ' ');
          setShowSuggestions(false);
          setSelectedSuggestion(0);
          commandHistory.reset();
        }
        return;
      }
    }

    // Handle command history navigation when NOT showing suggestions
    if (!showSuggestions) {
      // Arrow up - previous command in history
      if (event.name === 'up') {
        const prev = commandHistory.getPrevious();
        if (prev !== null) {
          setValue(prev);
        }
        return;
      }

      // Arrow down - next command in history
      if (event.name === 'down') {
        const next = commandHistory.getNext();
        if (next !== null) {
          setValue(next);
        }
        return;
      }
    }

    // Ctrl+C - handled at App level for two-stage exit
    // In raw mode: First Ctrl+C kills TTY, second Ctrl+C exits Clive
    // In normal mode: Ctrl+C exits Clive immediately (no active session)
    if (event.ctrl && event.name === 'c') {
      // Don't send to PTY, let App.tsx handle it
      return;
    }

    // Note: Regular character input (typing) is NOT handled here
    // It's handled by the native input component's onInput callback
  });

  const handleSubmit = (submittedValue: string) => {
    // In raw input mode, don't handle submit (already handled by raw key press)
    if (rawInputMode) return;
    if (!submittedValue.trim()) return;

    const cmd = submittedValue.trim();
    commandHistory.add(cmd);
    onSubmit(cmd);
    setValue('');
    commandHistory.reset();
    setShowSuggestions(false);
    setSelectedSuggestion(0);
  };

  const handleInput = (newValue: string) => {
    // In raw input mode, don't handle input (already handled by raw key press)
    if (rawInputMode) return;
    setValue(newValue);
    commandHistory.reset();
  };

  // Calculate dynamic height
  const baseHeight = 3;
  const questionHeight = pendingQuestion ? Math.min(25, 20) : 0; // Cap at 25, typical height ~20
  const suggestionsHeight = showSuggestions ? Math.min(filteredSuggestions.length + 2, 8) : 0;
  const totalHeight = baseHeight + questionHeight + suggestionsHeight;

  const placeholder = disabled
    ? 'Input disabled during question'
    : rawInputMode
      ? 'Interactive mode: Use arrow keys, Enter, Esc...'
      : isRunning
        ? 'Type message or /add task...'
        : 'Type / for commands or enter prompt...';

  return (
    <box width={width} height={totalHeight} flexDirection="column">
      {/* Question Panel (appears above input) */}
      {pendingQuestion && onQuestionAnswer && (
        <QuestionPanel
          width={width - 2}
          height={questionHeight}
          question={pendingQuestion}
          onAnswer={onQuestionAnswer}
          onCancel={onQuestionCancel}
        />
      )}

      {/* Suggestions Panel (appears above input) */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <SuggestionsPanel
          suggestions={filteredSuggestions}
          selectedIndex={selectedSuggestion}
          width={width - 2}
        />
      )}

      {/* Input Box */}
      <box
        width={width}
        height={baseHeight}
        backgroundColor={OneDarkPro.background.secondary}
        borderStyle="single"
        borderColor={
          rawInputMode
            ? OneDarkPro.ui.border
            : inputFocused
              ? OneDarkPro.syntax.green
              : OneDarkPro.ui.border
        }
        paddingLeft={1}
        paddingRight={1}
        opacity={rawInputMode ? 0.5 : 1.0}
      >
        <box flexDirection="row" width="100%">
          <text fg={rawInputMode ? OneDarkPro.ui.border : OneDarkPro.syntax.green}>
            {rawInputMode ? '⊙ ' : '❯ '}
          </text>
          <input
            ref={inputRef}
            value={rawInputMode ? '' : value}
            placeholder={placeholder}
            focused={inputFocused && !disabled && !rawInputMode}
            disabled={disabled || rawInputMode}
            onInput={handleInput}
            onSubmit={handleSubmit}
            style={{
              flexGrow: 1,
            }}
          />
        </box>
      </box>
    </box>
  );
}
