/**
 * QuestionPanel Component
 * Displays AskUserQuestion tool prompt with navigation and submission
 * Supports both single-select and multi-select question modes
 */

import { useKeyboard } from "@opentui/react";
import { useEffect, useState } from "react";
import { OneDarkPro } from "../styles/theme";
import type { QuestionData } from "../types";
import { debugLog } from "../utils/debug-logger";

/**
 * Calculate the height needed for a QuestionPanel based on its content.
 * Used by both DynamicInput and App to allocate the right amount of vertical space.
 */
export function calculateQuestionHeight(question: QuestionData): number {
  const current = question.questions[0];
  if (!current) return 0;

  const optionCount = current.options.length + 1; // +1 for "Other"
  const hasDescriptions = current.options.some((o) => o.description);

  let h = 0;
  h += 2; // border top + bottom
  h += 2; // padding top + bottom
  if (question.questions.length > 1) h += 1; // progress indicator
  h += 1; // header line
  h += 1; // spacing after header
  h += 1; // question text
  h += 1; // spacing after question
  h += optionCount * (hasDescriptions ? 3 : 2); // each option: label + margin (+ description line)
  if (current.multiSelect) h += 1; // multi-select submit hint
  h += 1; // help text
  h += 1; // spacing before help text

  return Math.min(25, h);
}

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

  // Selected option index for current question (cursor position)
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Multi-select: set of toggled option indices
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(),
  );

  // Collected answers (question text -> selected option value)
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Custom input state for "Other" option
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInput, setCustomInput] = useState("");

  const currentQuestion = question.questions[currentIndex];
  const isLastQuestion = currentIndex === question.questions.length - 1;
  const isMultiSelect = currentQuestion?.multiSelect ?? false;

  // Guard: if no question at current index, render nothing
  if (!currentQuestion) return null;

  // Add "Other" option to the end of options list
  const optionsWithOther = [
    ...currentQuestion.options,
    { label: "Other", description: "Enter a custom answer" },
  ];
  const isOtherSelected = selectedIndex === optionsWithOther.length - 1;

  const advanceToNextQuestion = (newAnswers: Record<string, string>) => {
    setAnswers(newAnswers);
    if (isLastQuestion) {
      onAnswer(newAnswers);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setSelectedIndex(0);
      setSelectedIndices(new Set());
    }
  };

  const submitMultiSelect = () => {
    if (selectedIndices.size === 0) return;
    const labels = [...selectedIndices]
      .sort((a, b) => a - b)
      .map((i) => currentQuestion.options[i]?.label)
      .filter(Boolean)
      .join(", ");
    const newAnswers = { ...answers, [currentQuestion.question]: labels };
    advanceToNextQuestion(newAnswers);
  };

  const toggleIndex = (index: number) => {
    // Don't toggle "Other" in multi-select — it triggers custom input
    if (index === optionsWithOther.length - 1) {
      setShowCustomInput(true);
      return;
    }
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Keyboard navigation
  useKeyboard((key) => {
    // If custom input is showing, handle differently
    if (showCustomInput) {
      if (key.name === "return" && customInput.trim()) {
        handleCustomSubmit();
      } else if (key.name === "escape") {
        setShowCustomInput(false);
        setCustomInput("");
      }
      return; // Let input component handle other keys
    }

    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((prev) =>
        prev > 0 ? prev - 1 : optionsWithOther.length - 1,
      );
    } else if (key.name === "down" || key.name === "j") {
      setSelectedIndex((prev) =>
        prev < optionsWithOther.length - 1 ? prev + 1 : 0,
      );
    } else if (key.name === "return") {
      handleSelect();
    } else if (key.name === "escape") {
      onCancel?.();
    } else if (key.sequence === " " && isMultiSelect) {
      // Space toggles selection in multi-select mode
      toggleIndex(selectedIndex);
    } else if (key.sequence === "d" && isMultiSelect) {
      // 'd' submits multi-select
      submitMultiSelect();
    } else if (key.sequence && /^[1-9]$/.test(key.sequence)) {
      // Number key selection (1-9)
      const index = parseInt(key.sequence, 10) - 1;
      if (index < optionsWithOther.length) {
        setSelectedIndex(index);

        if (isMultiSelect) {
          // In multi-select, number keys toggle
          setTimeout(() => toggleIndex(index), 100);
        } else {
          // Auto-submit on number key in single-select
          setTimeout(() => {
            if (index === optionsWithOther.length - 1) {
              setShowCustomInput(true);
            } else {
              const selectedOption = currentQuestion.options[index];
              if (!selectedOption) return;
              const newAnswers = {
                ...answers,
                [currentQuestion.question]: selectedOption.label,
              };
              advanceToNextQuestion(newAnswers);
            }
          }, 100);
        }
      }
    }
  });

  const handleSelect = () => {
    if (isMultiSelect) {
      // In multi-select, Enter toggles the current option (or submits if "Other")
      if (isOtherSelected) {
        setShowCustomInput(true);
      } else {
        toggleIndex(selectedIndex);
      }
      return;
    }

    // Single-select: Check if "Other" is selected
    if (isOtherSelected) {
      setShowCustomInput(true);
      return;
    }

    const selectedOption = currentQuestion.options[selectedIndex];
    if (!selectedOption) return;
    const newAnswers = {
      ...answers,
      [currentQuestion.question]: selectedOption.label,
    };
    advanceToNextQuestion(newAnswers);
  };

  const handleCustomSubmit = () => {
    if (!customInput.trim()) return;

    if (isMultiSelect) {
      // In multi-select, add custom input to the selected labels
      const existingLabels = [...selectedIndices]
        .sort((a, b) => a - b)
        .map((i) => currentQuestion.options[i]?.label)
        .filter(Boolean);
      existingLabels.push(customInput.trim());
      const newAnswers = {
        ...answers,
        [currentQuestion.question]: existingLabels.join(", "),
      };
      setShowCustomInput(false);
      setCustomInput("");
      advanceToNextQuestion(newAnswers);
    } else {
      const newAnswers = {
        ...answers,
        [currentQuestion.question]: customInput.trim(),
      };
      setShowCustomInput(false);
      setCustomInput("");
      advanceToNextQuestion(newAnswers);
    }
  };

  // Debug: log panel dimensions
  useEffect(() => {
    debugLog("QuestionPanel", "Rendering with dimensions", {
      width,
      height,
      currentQuestion: currentQuestion.header,
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
          {isMultiSelect ? "☑ " : "❓ "}
          {currentQuestion.header}
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
          const isCursor = i === selectedIndex;
          const isChecked = isMultiSelect && selectedIndices.has(i);

          return (
            <box
              key={i}
              marginBottom={1}
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={
                isCursor ? OneDarkPro.background.highlight : "transparent"
              }
              flexDirection="column"
            >
              {/* Option label with number shortcut and selection indicator */}
              <box
                flexDirection="row"
                alignItems="center"
                marginBottom={option.description ? 1 : 0}
              >
                {/* Number shortcut badge */}
                <text
                  bg={
                    isCursor
                      ? OneDarkPro.syntax.blue
                      : OneDarkPro.background.secondary
                  }
                  fg={
                    isCursor
                      ? OneDarkPro.background.primary
                      : OneDarkPro.foreground.muted
                  }
                >
                  {` ${i + 1} `}
                </text>
                {/* Spacing */}
                <text> </text>
                {/* Selection indicator */}
                {isMultiSelect ? (
                  <text
                    fg={
                      isChecked
                        ? OneDarkPro.syntax.green
                        : OneDarkPro.foreground.muted
                    }
                  >
                    {isChecked ? "[x]" : "[ ]"}
                  </text>
                ) : (
                  <text
                    fg={isCursor ? OneDarkPro.syntax.green : "transparent"}
                  >
                    {isCursor ? "▸" : " "}
                  </text>
                )}
                {/* Spacing */}
                <text> </text>
                {/* Option label */}
                <text
                  fg={
                    isCursor || isChecked
                      ? OneDarkPro.foreground.primary
                      : OneDarkPro.foreground.secondary
                  }
                >
                  {option.label}
                </text>
              </box>

              {/* Option description on separate line with more indentation */}
              {option.description && (
                <box paddingLeft={6}>
                  <text fg={OneDarkPro.foreground.comment}>
                    {option.description}
                  </text>
                </box>
              )}
            </box>
          );
        })}
      </box>

      {/* Multi-select submit hint */}
      {isMultiSelect && selectedIndices.size > 0 && !showCustomInput && (
        <box marginTop={1}>
          <text fg={OneDarkPro.syntax.green}>
            {selectedIndices.size} selected — press d to submit
          </text>
        </box>
      )}

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
            ? "Type your answer • Enter Submit • Esc Cancel"
            : isMultiSelect
              ? `1-${optionsWithOther.length} Toggle • Space Toggle • ↑/↓ Navigate • d Submit • Esc Cancel`
              : `1-${optionsWithOther.length} Select • ↑/↓ Navigate • Enter Confirm • Esc Cancel`}
        </text>
      </box>
    </box>
  );
}
