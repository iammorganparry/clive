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

  const currentQuestion = question.questions[currentIndex];
  const isLastQuestion = currentIndex === question.questions.length - 1;

  // Debug log when component mounts
  useEffect(() => {
    debugLog('QuestionPanel', 'Component mounted', {
      toolUseID: question.toolUseID,
      questionCount: question.questions.length,
      firstQuestion: currentQuestion.header
    });
  }, []);

  // Debug log when question changes
  useEffect(() => {
    debugLog('QuestionPanel', 'Current question changed', {
      index: currentIndex,
      header: currentQuestion.header,
      isLastQuestion,
      multiSelect: currentQuestion.multiSelect
    });
  }, [currentIndex]);

  // Keyboard navigation
  useKeyboard((key) => {
    if (key.name === 'up' || key.name === 'k') {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : currentQuestion.options.length - 1
      );
    } else if (key.name === 'down' || key.name === 'j') {
      setSelectedIndex((prev) =>
        prev < currentQuestion.options.length - 1 ? prev + 1 : 0
      );
    } else if (key.name === 'return') {
      handleSelect();
    } else if (key.name === 'escape') {
      onCancel?.();
    } else if (/^[1-9]$/.test(key.key)) {
      // Number key selection (1-9)
      const index = parseInt(key.key) - 1;
      if (index < currentQuestion.options.length) {
        setSelectedIndex(index);
        // Auto-submit on number key
        setTimeout(() => {
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
        }, 100);
      }
    }
  });

  const handleSelect = () => {
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

  // Center panel
  const panelWidth = Math.min(width - 4, 80);
  const panelHeight = Math.min(height - 4, 30);
  const panelX = Math.floor((width - panelWidth) / 2);
  const panelY = Math.floor((height - panelHeight) / 2);

  // Debug: log panel dimensions and position
  useEffect(() => {
    debugLog('QuestionPanel', 'Rendering with dimensions', {
      width,
      height,
      panelWidth,
      panelHeight,
      panelX,
      panelY,
      currentQuestion: currentQuestion.header
    });
  }, [width, height, panelWidth, panelHeight, panelX, panelY, currentQuestion.header]);

  return (
    <box
      position="absolute"
      x={panelX}
      y={panelY}
      width={panelWidth}
      height={panelHeight}
      backgroundColor={OneDarkPro.background.secondary}
      borderStyle="rounded"
      borderColor={OneDarkPro.syntax.blue}
      padding={2}
      flexDirection="column"
      zIndex={1000}
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
        <text fg={OneDarkPro.syntax.blue} bold>
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
        {currentQuestion.options.map((option, i) => {
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
            >
              <box flexDirection="row" width="100%">
                {/* Selection indicator */}
                <text
                  color={
                    isSelected
                      ? OneDarkPro.syntax.green
                      : OneDarkPro.foreground.muted
                  }
                  width={3}
                >
                  {isSelected ? '▸ ' : '  '}
                </text>

                {/* Option content */}
                <box flexDirection="column" flexGrow={1}>
                  <text
                    color={
                      isSelected
                        ? OneDarkPro.foreground.primary
                        : OneDarkPro.foreground.secondary
                    }
                    bold={isSelected}
                  >
                    {option.label}
                  </text>

                  {option.description && (
                    <text
                      color={OneDarkPro.foreground.muted}
                      fontSize={0.9}
                    >
                      {option.description}
                    </text>
                  )}
                </box>
              </box>
            </box>
          );
        })}
      </box>

      {/* Help text */}
      <box marginTop={1}>
        <text fg={OneDarkPro.foreground.muted}>
          1-{currentQuestion.options.length} Select • ↑/↓ Navigate • Enter Confirm • Esc Cancel
        </text>
      </box>
    </box>
  );
}
