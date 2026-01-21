import { useState, useRef, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { SuggestionsPanel, type CommandSuggestion } from './SuggestionsPanel';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { usePaste } from '../hooks/usePaste';
import { OneDarkPro } from '../styles/theme';

// Available commands
const COMMANDS: CommandSuggestion[] = [
  { cmd: '/plan', desc: 'Create a work plan' },
  { cmd: '/build', desc: 'Execute work plan' },
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
}

export function DynamicInput({
  width,
  onSubmit,
  disabled = false,
  isRunning = false,
  inputFocused = false,
  onFocusChange,
  preFillValue,
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

  // Filter suggestions based on input
  const filteredSuggestions = value.startsWith('/') && !value.includes(' ')
    ? COMMANDS.filter((c) => c.cmd.startsWith(value))
    : [];

  // Show suggestions when typing "/" commands
  useEffect(() => {
    if (filteredSuggestions.length > 0 && inputFocused) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
      setSelectedSuggestion(0);
    }
  }, [filteredSuggestions.length, inputFocused]);

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

    // Ctrl+C - cancel running process
    if (event.ctrl && event.name === 'c') {
      if (isRunning) {
        onSubmit('/cancel');
      }
      return;
    }

    // Note: Regular character input (typing) is NOT handled here
    // It's handled by the native input component's onInput callback
  });

  const handleSubmit = (submittedValue: string) => {
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
    setValue(newValue);
    commandHistory.reset();
  };

  // Calculate dynamic height
  const baseHeight = 3;
  const suggestionsHeight = showSuggestions ? Math.min(filteredSuggestions.length + 2, 8) : 0;
  const totalHeight = baseHeight + suggestionsHeight;

  const placeholder = disabled
    ? 'Input disabled during question'
    : isRunning
      ? 'Type message or /add task...'
      : 'Type / for commands or enter prompt...';

  return (
    <box width={width} height={totalHeight} flexDirection="column">
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
        borderColor={inputFocused ? OneDarkPro.syntax.green : OneDarkPro.ui.border}
        paddingLeft={1}
        paddingRight={1}
      >
        <box flexDirection="row" width="100%">
          <text fg={OneDarkPro.syntax.green}>❯ </text>
          <input
            ref={inputRef}
            value={value}
            placeholder={placeholder}
            focused={inputFocused && !disabled}
            disabled={disabled}
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
