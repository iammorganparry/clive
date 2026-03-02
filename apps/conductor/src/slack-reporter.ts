/**
 * Slack Reporter
 *
 * Reports conductor status to Slack threads using @slack/web-api.
 * Provides rich block-based messages for progress tracking.
 */

import type { WebClient } from "@slack/web-api";
import type { ConductorConfig } from "./config.js";
import type { SlackThread, TaskEntry } from "./types.js";

const STATE_EMOJI: Record<string, string> = {
  pending: ":hourglass:",
  planning: ":thinking_face:",
  spawning: ":rocket:",
  building: ":hammer_and_wrench:",
  pr_open: ":git-pull-request:",
  reviewing: ":eyes:",
  complete: ":white_check_mark:",
  failed: ":x:",
};

export class SlackReporter {
  private client: WebClient | null = null;

  constructor(private readonly config: ConductorConfig) {
    if (config.slackBotToken) {
      // Lazy import to avoid requiring @slack/web-api when not configured
      import("@slack/web-api").then(({ WebClient }) => {
        this.client = new WebClient(config.slackBotToken);
      });
    }
  }

  /** Post a status update to a Slack thread */
  async postUpdate(thread: SlackThread, text: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.chat.postMessage({
        channel: thread.channel,
        thread_ts: thread.threadTs,
        text,
      });
    } catch (error) {
      console.warn("[SlackReporter] Failed to post update:", error);
    }
  }

  /** Post rich status blocks for a task */
  async postTaskStatus(thread: SlackThread, task: TaskEntry): Promise<void> {
    if (!this.client) return;

    const stateEmoji = STATE_EMOJI[task.state] || ":grey_question:";
    const agentLines = task.agents
      .map((a) => `  \u2022 \`${a.acpxSessionName}\` \u2014 ${a.status}`)
      .join("\n");

    const blocks = [
      {
        type: "section" as const,
        text: {
          type: "mrkdwn" as const,
          text: `${stateEmoji} *Task ${task.id}*: ${task.state.toUpperCase()}`,
        },
      },
      ...(task.agents.length > 0
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: `*Agents:*\n${agentLines}`,
              },
            },
          ]
        : []),
      ...(task.prUrl
        ? [
            {
              type: "section" as const,
              text: {
                type: "mrkdwn" as const,
                text: `*PR:* <${task.prUrl}|View PR> | CI: ${task.ciStatus || "n/a"} | Review: ${task.reviewStatus || "n/a"}`,
              },
            },
          ]
        : []),
    ];

    try {
      await this.client.chat.postMessage({
        channel: thread.channel,
        thread_ts: thread.threadTs,
        text: `Task ${task.id}: ${task.state}`,
        blocks,
      });
    } catch (error) {
      console.warn("[SlackReporter] Failed to post task status:", error);
    }
  }

  /** Post error notification */
  async postError(thread: SlackThread, message: string): Promise<void> {
    await this.postUpdate(thread, `:x: *Error:* ${message}`);
  }

  /** Post completion notification */
  async postCompletion(thread: SlackThread, task: TaskEntry): Promise<void> {
    const prLink = task.prUrl ? `\n:link: <${task.prUrl}|View PR>` : "";
    await this.postUpdate(
      thread,
      `:white_check_mark: *Task ${task.id} complete!*${prLink}`,
    );
  }
}
