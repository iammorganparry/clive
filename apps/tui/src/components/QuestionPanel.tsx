/**
 * QuestionPanel Component
 * Displays AskUserQuestion tool prompt with navigation and submission
 */

import { useState, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { OneDarkPro } from '../styles/theme';
import type { QuestionData } from '../types';
import { debugLog } from '../utils/debug-logger';

interface QuestionPanelProps {
  width: number;
  height: number;
  question: QuestionData;
  onAnswer: (answers: Record<string, string>) => void;
  onCancel?: () => void;
}

export function QuestionPanel({
  width,
  height,
  question,
  onAnswer,
  onCancel,
}: QuestionPanelProps) {
  // Current question index (for multi-question support)
  const [currentIndex, setCurrentIndex] = useState(0);

  // Selected option index for current question
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Collected answers (question header -> selected option value)
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Custom input state for "Other" option
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState('');

  const currentQuestion = question.questions[currentIndex];
  const isLastQuestion = currentIndex === question.questions.length - 1;

  // Add "Other" option to the end of options list
  const optionsWithOther = [
    ...currentQuestion.options,
    { label: 'Other', description: 'Enter a custom answer' }
  ];
  const isOtherSelected = selectedIndex === optionsWithOther.length - 1;

  // Keyboard navigation
  useKeyboard((key) => {
    // If custom input is showing, handle differently
    if (showCustomInput) {
      if (key.name === 'return' && customInput.trim()) {
        handleCustomSubmit();
      } else if (key.name === 'escape') {
        setShowCustomInput(false);
        setCustomInput('');
      }
      return; // Let input component handle other keys
    }

    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : optionsWithOther.length - 1
      );
    } else if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex((prev) =>
        prev < optionsWithOther.length - 1 ? prev + 1 : 0
      );
    } else if (key.name === 'return') {
      handleSelect();
    } else if (key.name === 'escape') {
      onCancel?.();
    } else if (/^[1-9]$/.test(key.key)) {
      // Number key selection (1-9)
      const index = parseInt(key.key) - 1;
      if (index < optionsWithOther.length) {
        setSelectedIndex(index);
        // Auto-submit on number key
        setTimeout(() => {
          if (index === optionsWithOther.length - 1) {
            // Selected "Other" - show input
            setShowCustomInput(true);
          } else {
            const selectedOption = currentQuestion.options[index];
            const newAnswers = {
              ...answers,
              [currentQuestion.header]: selectedOption.label,
            };
            setAnswers(newAnswers);

            if (isLastQuestion) {
              onAnswer(newAnswers);
            } else {
              setCurrentIndex((prev) => prev + 1);
              setSelectedIndex(0);
            }
          }
        }, 100);
      }
    }
  });

  const handleSelect = () => {
    // Check if "Other" is selected
    if (isOtherSelected) {
      setShowCustomInput(true);
      return;
    }

    const selectedOption = currentQuestion.options[selectedIndex];
    const newAnswers = {
      ...answers,
      [currentQuestion.header]: selectedOption.label,
    };
    setAnswers(newAnswers);

    if (isLastQuestion) {
      // Submit all answers
      onAnswer(newAnswers);
    } else {
      // Move to next question
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(0);
    }
  };

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return;

    const newAnswers = {
      ...answers,
      [currentQuestion.header]: customInput.trim(),
    };
    setAnswers(newAnswers);
    setShowCustomInput(false);
    setCustomInput('');

    if (isLastQuestion) {
      // Submit all answers
      onAnswer(newAnswers);
    } else {
      // Move to next question
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(0);
    }
  };

  // Debug: log panel dimensions
  useEffect(() => {
    debugLog('QuestionPanel', 'Rendering with dimensions', {
      width,
      height,
      currentQuestion: currentQuestion.header
    });
  }, [width, height, currentQuestion.header]);

  return (
    <box
      width={width}
      height={height}
      backgroundColor={OneDarkPro.background.secondary}
      borderStyle="rounded"
      borderColor={OneDarkPro.syntax.blue}
      padding={2}
      flexDirection="column"
    >
      {/* Progress indicator */}
      {question.questions.length > 1 && (
        <box marginBottom={1}>
          <text fg={OneDarkPro.foreground.muted}>
            Question {currentIndex + 1} of {question.questions.length}
          </text>
        </box>
      )}

      {/* Header */}
      <box marginBottom={1}>
        <text fg={OneDarkPro.syntax.blue}>
          ❓ {currentQuestion.header}
        </text>
      </box>

      {/* Question text */}
      <box marginBottom={2}>
        <text fg={OneDarkPro.foreground.primary}>
          {currentQuestion.question}
        </text>
      </box>

      {/* Options */}
      <box flexDirection="column" flexGrow={1}>
        {optionsWithOther.map((option, i) => {
          const isSelected = i === selectedIndex;

          return (
            <box
              key={i}
              marginBottom={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                isSelected
                  ? OneDarkPro.background.highlight
                  : 'transparent'
              }
              flexDirection="column"
            >
              {/* Option label with selection indicator */}
              <box flexDirection="row">
                <text fg={isSelected ? OneDarkPro.syntax.green : OneDarkPro.foreground.muted}>
                  {isSelected ? '▸ ' : '  '}
                </text>
                <text fg={isSelected ? OneDarkPro.foreground.primary : OneDarkPro.foreground.secondary}>
                  {option.label}
                </text>
              </box>

              {/* Option description on separate line */}
              {option.description && (
                <box paddingLeft={3}>
                  <text fg={OneDarkPro.foreground.muted}>
                    {option.description}
                  </text>
                </box>
              )}
            </box>
          );
        })}
      </box>

      {/* Custom input field (shown when "Other" is selected) */}
      {showCustomInput && (
        <box
          marginTop={1}
          marginBottom={1}
          paddingLeft={2}
          paddingRight={2}
          borderStyle="single"
          borderColor={OneDarkPro.syntax.green}
        >
          <box flexDirection="row" width="100%">
            <text fg={OneDarkPro.syntax.green}>❯ </text>
            <input
              value={customInput}
              placeholder="Enter your answer..."
              focused={true}
              onInput={(newValue: string) => setCustomInput(newValue)}
              onSubmit={handleCustomSubmit}
              style={{ flexGrow: 1 }}
            />
          </box>
        </box>
      )}

      {/* Help text */}
      <box marginTop={1}>
        <text fg={OneDarkPro.foreground.muted}>
          {showCustomInput
            ? 'Type your answer • Enter Submit • Esc Cancel'
            : `1-${optionsWithOther.length} Select • ↑/↓ Navigate • Enter Confirm • Esc Cancel`
          }
        </text>
      </box>
    </box>
  );
}
