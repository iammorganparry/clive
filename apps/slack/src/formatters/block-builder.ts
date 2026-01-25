/**
 * Block Builder
 *
 * Utilities for building Slack Block Kit messages.
 */

import type {
  ActionsBlock,
  Button,
  ContextBlock,
  DividerBlock,
  HeaderBlock,
  KnownBlock,
  SectionBlock,
} from "@slack/types";

/**
 * Create a header block
 */
export function header(text: string): HeaderBlock {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: text.substring(0, 150), // Slack limit
      emoji: true,
    },
  };
}

/**
 * Create a section block with markdown text
 */
export function section(text: string): SectionBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: text.substring(0, 3000), // Slack limit
    },
  };
}

/**
 * Create a section with accessory button
 */
export function sectionWithButton(
  text: string,
  buttonText: string,
  actionId: string,
  value?: string,
): SectionBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: text.substring(0, 3000),
    },
    accessory: {
      type: "button",
      text: {
        type: "plain_text",
        text: buttonText.substring(0, 75), // Slack limit
        emoji: true,
      },
      action_id: actionId,
      value: value,
    },
  };
}

/**
 * Create a divider block
 */
export function divider(): DividerBlock {
  return {
    type: "divider",
  };
}

/**
 * Create a context block with mrkdwn elements
 */
export function context(texts: string[]): ContextBlock {
  return {
    type: "context",
    elements: texts.map((text) => ({
      type: "mrkdwn",
      text: text.substring(0, 3000),
    })),
  };
}

/**
 * Create a button element
 */
export function button(
  text: string,
  actionId: string,
  value?: string,
  style?: "primary" | "danger",
): Button {
  const btn: Button = {
    type: "button",
    text: {
      type: "plain_text",
      text: text.substring(0, 75),
      emoji: true,
    },
    action_id: actionId,
  };

  if (value) {
    btn.value = value;
  }

  if (style) {
    btn.style = style;
  }

  return btn;
}

/**
 * Create an actions block with buttons
 * Slack limits: max 25 elements, max 5 buttons per row typically
 */
export function actions(buttons: Button[], blockId?: string): ActionsBlock {
  return {
    type: "actions",
    block_id: blockId,
    elements: buttons.slice(0, 25), // Slack limit
  };
}

/**
 * Split buttons into multiple action blocks (max 5 per row)
 */
export function actionsRows(
  buttons: Button[],
  blockIdPrefix?: string,
): ActionsBlock[] {
  const rows: ActionsBlock[] = [];
  const maxPerRow = 5;

  for (let i = 0; i < buttons.length; i += maxPerRow) {
    const rowButtons = buttons.slice(i, i + maxPerRow);
    rows.push({
      type: "actions",
      block_id: blockIdPrefix
        ? `${blockIdPrefix}_${Math.floor(i / maxPerRow)}`
        : undefined,
      elements: rowButtons,
    });
  }

  return rows;
}

/**
 * Create a loading/progress indicator section
 */
export function loading(message: string): SectionBlock {
  return section(`:hourglass_flowing_sand: ${message}`);
}

/**
 * Create an error section
 */
export function error(message: string): SectionBlock {
  return section(`:x: *Error:* ${message}`);
}

/**
 * Create a success section
 */
export function success(message: string): SectionBlock {
  return section(`:white_check_mark: ${message}`);
}

/**
 * Create a warning section
 */
export function warning(message: string): SectionBlock {
  return section(`:warning: ${message}`);
}

/**
 * Create info section
 */
export function info(message: string): SectionBlock {
  return section(`:information_source: ${message}`);
}

/**
 * Combine multiple blocks
 */
export function blocks(...items: (KnownBlock | KnownBlock[])[]): KnownBlock[] {
  return items.flat();
}

/**
 * Create a modal view for "Other" custom input
 */
export function otherInputModal(
  questionHeader: string,
  questionText: string,
  threadTs: string,
  toolUseId: string,
): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: "other_input_modal",
    private_metadata: JSON.stringify({ threadTs, toolUseId, questionHeader }),
    title: {
      type: "plain_text",
      text: "Custom Answer",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "Submit",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "Cancel",
      emoji: true,
    },
    blocks: [
      section(questionText),
      {
        type: "input",
        block_id: "custom_answer_block",
        element: {
          type: "plain_text_input",
          action_id: "custom_answer_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Enter your custom answer...",
          },
        },
        label: {
          type: "plain_text",
          text: questionHeader,
          emoji: true,
        },
      },
    ],
  };
}

/**
 * Format markdown for Slack (convert GitHub-flavored to Slack mrkdwn)
 */
export function formatMarkdown(md: string): string {
  return (
    md
      // Convert headers
      .replace(/^### (.+)$/gm, "*$1*")
      .replace(/^## (.+)$/gm, "*$1*")
      .replace(/^# (.+)$/gm, "*$1*")
      // Convert bold
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      // Convert italic (single underscore/asterisk to Slack italic)
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "_$1_")
      // Convert code blocks
      .replace(/```(\w+)?\n([\s\S]*?)```/g, "```$2```")
      // Convert inline code
      .replace(/`([^`]+)`/g, "`$1`")
      // Convert links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>")
  );
}
