import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { type FC, useCallback, useState } from "react";
import { useTheme } from "../theme.js";
import type { AgentQuestion } from "../utils/claude-events.js";

export interface QuestionPromptProps {
  /** Questions from AskUserQuestion tool */
  questions: AgentQuestion[];
  /** Called when user submits answers */
  onSubmit: (answers: Record<string, string>) => void;
  /** Called when user cancels */
  onCancel?: () => void;
}

export const QuestionPrompt: FC<QuestionPromptProps> = ({
  questions,
  onSubmit,
  onCancel,
}) => {
  const theme = useTheme();
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isOtherMode, setIsOtherMode] = useState(false);
  const [otherText, setOtherText] = useState("");

  const currentQuestion = questions[currentQuestionIndex];
  // Add "Other" option to each question
  const allOptions = [
    ...(currentQuestion?.options || []),
    { label: "Other", description: "Enter custom response" },
  ];

  const handleSelectOption = useCallback(() => {
    if (!currentQuestion) return;

    const questionKey = currentQuestion.header || `q${currentQuestionIndex}`;

    // Check if "Other" was selected (last option)
    if (selectedOptionIndex === allOptions.length - 1) {
      setIsOtherMode(true);
      return;
    }

    const selectedOption = allOptions[selectedOptionIndex];
    const newAnswers = { ...answers, [questionKey]: selectedOption.label };
    setAnswers(newAnswers);

    // Move to next question or submit
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOptionIndex(0);
    } else {
      onSubmit(newAnswers);
    }
  }, [
    currentQuestion,
    currentQuestionIndex,
    selectedOptionIndex,
    allOptions,
    answers,
    questions.length,
    onSubmit,
  ]);

  const handleOtherSubmit = useCallback(() => {
    if (!currentQuestion || !otherText.trim()) return;

    const questionKey = currentQuestion.header || `q${currentQuestionIndex}`;
    const newAnswers = { ...answers, [questionKey]: otherText.trim() };
    setAnswers(newAnswers);
    setIsOtherMode(false);
    setOtherText("");

    // Move to next question or submit
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOptionIndex(0);
    } else {
      onSubmit(newAnswers);
    }
  }, [
    currentQuestion,
    currentQuestionIndex,
    otherText,
    answers,
    questions.length,
    onSubmit,
  ]);

  // Direct selection by number
  const selectOptionByIndex = useCallback(
    (index: number) => {
      if (!currentQuestion) return;

      const questionKey = currentQuestion.header || `q${currentQuestionIndex}`;

      // Check if "Other" was selected (last option)
      if (index === allOptions.length - 1) {
        setSelectedOptionIndex(index);
        setIsOtherMode(true);
        return;
      }

      const selectedOption = allOptions[index];
      const newAnswers = { ...answers, [questionKey]: selectedOption.label };
      setAnswers(newAnswers);

      // Move to next question or submit
      if (currentQuestionIndex < questions.length - 1) {
        setCurrentQuestionIndex(currentQuestionIndex + 1);
        setSelectedOptionIndex(0);
      } else {
        onSubmit(newAnswers);
      }
    },
    [
      currentQuestion,
      currentQuestionIndex,
      allOptions,
      answers,
      questions.length,
      onSubmit,
    ],
  );

  useInput(
    (input, key) => {
      if (isOtherMode) {
        if (key.escape) {
          setIsOtherMode(false);
          setOtherText("");
        }
        return; // Let TextInput handle other keys
      }

      if (key.upArrow) {
        setSelectedOptionIndex((prev) =>
          prev > 0 ? prev - 1 : allOptions.length - 1,
        );
      }
      if (key.downArrow) {
        setSelectedOptionIndex((prev) =>
          prev < allOptions.length - 1 ? prev + 1 : 0,
        );
      }
      if (key.return || input === " ") {
        handleSelectOption();
      }
      // Number shortcuts for quick selection (1-9)
      const num = parseInt(input, 10);
      if (num >= 1 && num <= allOptions.length && num <= 9) {
        selectOptionByIndex(num - 1);
      }
      if (key.escape && onCancel) {
        onCancel();
      }
    },
    { isActive: !isOtherMode },
  );

  if (!currentQuestion) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.syntax.cyan}
      paddingX={1}
      paddingY={0}
      marginY={1}
    >
      {/* Header */}
      <Box marginBottom={1}>
        <Text color={theme.syntax.cyan} bold>
          Question {currentQuestionIndex + 1}/{questions.length}
        </Text>
        {currentQuestion.header && (
          <Text color={theme.fg.muted}> - {currentQuestion.header}</Text>
        )}
      </Box>

      {/* Question text */}
      <Box marginBottom={1}>
        <Text color={theme.fg.primary} bold>
          {currentQuestion.question}
        </Text>
      </Box>

      {/* Options or Other input */}
      {isOtherMode ? (
        <Box flexDirection="column">
          <Text color={theme.fg.muted}>Enter your response:</Text>
          <Box marginTop={1}>
            <Text color={theme.syntax.green}>{"> "}</Text>
            <TextInput
              value={otherText}
              onChange={setOtherText}
              onSubmit={handleOtherSubmit}
              placeholder="Type your answer..."
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.fg.muted} dimColor>
              Press Enter to submit, Escape to go back
            </Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          {allOptions.map((option, index) => (
            <Box key={index} marginY={0}>
              <Text
                color={
                  index === selectedOptionIndex
                    ? theme.bg.primary
                    : theme.fg.primary
                }
                backgroundColor={
                  index === selectedOptionIndex ? theme.syntax.cyan : undefined
                }
                bold={index === selectedOptionIndex}
              >
                {index === selectedOptionIndex ? " > " : "   "}
                {index + 1}. {option.label}
              </Text>
              {option.description && index !== allOptions.length - 1 && (
                <Text color={theme.fg.muted}> - {option.description}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Help text */}
      {!isOtherMode && (
        <Box marginTop={1}>
          <Text color={theme.fg.muted} dimColor>
            Use arrow keys or numbers to select, Enter to confirm
          </Text>
        </Box>
      )}
    </Box>
  );
};
