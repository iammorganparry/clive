import { useState, useRef, useEffect } from 'react';
import { SuggestionsPanel, type CommandSuggestion } from './SuggestionsPanel';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { useInputKeyboard } from '../hooks/useInputKeyboard';
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

  // Set up keyboard handling
  useInputKeyboard({
    inputRef,
    value,
    setValue,
    showSuggestions,
    setShowSuggestions,
    selectedSuggestion,
    setSelectedSuggestion,
    filteredSuggestions,
    getPreviousCommand: commandHistory.getPrevious,
    getNextCommand: commandHistory.getNext,
    resetHistoryIndex: commandHistory.reset,
    onSubmit,
    inputFocused,
    setInputFocused: (focused) => {
      if (onFocusChange) {
        onFocusChange(focused);
      }
    },
    isRunning,
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
