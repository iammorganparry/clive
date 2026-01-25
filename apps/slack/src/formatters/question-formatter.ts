/**
 * Question Formatter
 *
 * Formats AskUserQuestion data as Slack Block Kit messages.
 */

import type { KnownBlock } from "@slack/types";
import type { Question, QuestionData } from "../store/types";
import {
  actionsRows,
  blocks,
  button,
  context,
  divider,
  section,
} from "./block-builder";

/**
 * Action ID prefixes
 */
export const ACTION_IDS = {
  OPTION_PREFIX: "question_option_",
  OTHER: "question_other",
  APPROVE_PLAN: "approve_plan",
  REQUEST_CHANGES: "request_changes",
  MULTISELECT_DONE: "multiselect_done",
} as const;

/**
 * Format a question as Slack blocks
 */
export function formatQuestion(
  question: Question,
  questionIndex: number,
  toolUseId: string,
): KnownBlock[] {
  const questionBlocks: KnownBlock[] = [];

  // Question text
  questionBlocks.push(section(`*${question.header}*\n${question.question}`));

  // Options as buttons
  const optionButtons = question.options.map((option, optionIndex) =>
    button(
      option.label,
      `${ACTION_IDS.OPTION_PREFIX}${questionIndex}_${optionIndex}`,
      JSON.stringify({
        toolUseId,
        questionIndex,
        optionIndex,
        header: question.header,
        label: option.label,
      }),
    ),
  );

  // Add "Other..." button for custom input
  optionButtons.push(
    button(
      "Other...",
      ACTION_IDS.OTHER,
      JSON.stringify({
        toolUseId,
        questionIndex,
        header: question.header,
        question: question.question,
      }),
    ),
  );

  // Split into rows (max 5 per row)
  const actionRows = actionsRows(optionButtons, `q${questionIndex}_options`);
  questionBlocks.push(...actionRows);

  // Add option descriptions as context
  if (question.options.some((o) => o.description)) {
    const descriptions = question.options
      .filter((o) => o.description)
      .map((o) => `• *${o.label}:* ${o.description}`)
      .join("\n");

    if (descriptions) {
      questionBlocks.push(context([descriptions]));
    }
  }

  // Multi-select indicator
  if (question.multiSelect) {
    questionBlocks.push(
      context([
        "_You can select multiple options. Click 'Done' when finished._",
      ]),
    );
  }

  return questionBlocks;
}

/**
 * Format complete question data as Slack blocks
 */
export function formatQuestionData(questionData: QuestionData): KnownBlock[] {
  const allBlocks: KnownBlock[] = [];

  for (let i = 0; i < questionData.questions.length; i++) {
    const question = questionData.questions[i];
    if (i > 0) {
      allBlocks.push(divider());
    }
    allBlocks.push(...formatQuestion(question!, i, questionData.toolUseID));
  }

  return allBlocks;
}

/**
 * Format selected option (update message after selection)
 */
export function formatSelectedOption(
  question: Question,
  selectedLabel: string,
): KnownBlock[] {
  return [
    section(`*${question.header}*\n${question.question}`),
    section(`:white_check_mark: Selected: *${selectedLabel}*`),
  ];
}

/**
 * Format plan approval buttons
 */
export function formatPlanApproval(planPreview: string): KnownBlock[] {
  return blocks(
    section("*Plan Ready for Review*"),
    divider(),
    section(planPreview.substring(0, 2900)),
    divider(),
    {
      type: "actions",
      block_id: "plan_approval",
      elements: [
        button(
          "Approve & Create Issues",
          ACTION_IDS.APPROVE_PLAN,
          undefined,
          "primary",
        ),
        button("Request Changes", ACTION_IDS.REQUEST_CHANGES),
      ],
    },
  );
}

/**
 * Format phase indicator
 */
export function formatPhaseIndicator(phase: string): KnownBlock[] {
  const phaseEmojis: Record<string, string> = {
    starting: ":rocket:",
    problem: ":thinking_face:",
    scope: ":mag:",
    technical: ":gear:",
    confirmation: ":clipboard:",
    researching: ":books:",
    generating: ":writing_hand:",
    reviewing: ":eyes:",
    creating_issues: ":ticket:",
    completed: ":white_check_mark:",
    timed_out: ":hourglass:",
    error: ":x:",
  };

  const emoji = phaseEmojis[phase] || ":question:";
  const phaseText = phase
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return [context([`${emoji} *Phase:* ${phaseText}`])];
}

/**
 * Format timeout message
 */
export function formatTimeoutMessage(): KnownBlock[] {
  return blocks(
    section(":hourglass: *Interview Timed Out*"),
    section(
      "This planning interview has been inactive for 30 minutes and has been closed.\n\n" +
        "To start a new interview, mention @clive again.",
    ),
  );
}

/**
 * Format error message
 */
export function formatErrorMessage(error: string): KnownBlock[] {
  return blocks(
    section(":x: *Error*"),
    section(error),
    context(["Try starting a new interview by mentioning @clive again."]),
  );
}

/**
 * Format welcome message
 */
export function formatWelcomeMessage(hasDescription: boolean): KnownBlock[] {
  if (hasDescription) {
    return [
      section(
        ":wave: *Starting Planning Interview*\n\n" +
          "I'll guide you through a structured interview to understand your requirements. " +
          "Please answer each question to help me create a detailed plan.",
      ),
    ];
  }

  return [
    section(
      ":wave: *Hi! I'm Clive, your planning assistant.*\n\n" +
        "I'll help you plan your next feature or project through a structured interview. " +
        "What would you like to build?",
    ),
  ];
}

/**
 * Format completion message with Linear links
 */
export function formatCompletionMessage(linearUrls: string[]): KnownBlock[] {
  const urlList = linearUrls.map((url) => `• <${url}|View Issue>`).join("\n");

  return blocks(
    section(":white_check_mark: *Planning Complete!*"),
    section(
      "Your plan has been created and Linear issues have been generated:\n\n" +
        urlList,
    ),
    context(["Start a new planning session anytime by mentioning @clive."]),
  );
}

/**
 * Format non-initiator notice
 */
export function formatNonInitiatorNotice(initiatorId: string): KnownBlock[] {
  return [
    section(
      `:lock: This interview can only be answered by <@${initiatorId}>.\n\n` +
        "To start your own planning session, mention @clive in a new message.",
    ),
  ];
}
