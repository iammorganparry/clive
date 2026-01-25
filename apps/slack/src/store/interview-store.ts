/**
 * Interview Store
 *
 * Manages interview sessions tracked by Slack thread timestamp.
 * Handles session lifecycle, timeout, and cleanup.
 */

import type {
  AnswerPayload,
  InterviewPhase,
  InterviewSession,
  QuestionData,
} from "./types";

/**
 * Default session timeout: 30 minutes
 */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Interview Store for managing sessions
 */
export class InterviewStore {
  private sessions = new Map<string, InterviewSession>();
  private timeoutMs: number;

  constructor(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create a new interview session
   */
  create(
    threadTs: string,
    channel: string,
    initiatorId: string,
    initialDescription?: string,
  ): InterviewSession {
    // Clear any existing session for this thread
    this.close(threadTs);

    const now = new Date();
    const session: InterviewSession = {
      threadTs,
      channel,
      initiatorId,
      phase: "starting",
      initialDescription,
      answers: {},
      createdAt: now,
      lastActivityAt: now,
    };

    // Start timeout timer
    session.timeoutTimer = this.startTimeout(threadTs);

    this.sessions.set(threadTs, session);
    console.log(
      `[InterviewStore] Created session for thread ${threadTs}, initiator: ${initiatorId}`,
    );

    return session;
  }

  /**
   * Get a session by thread timestamp
   */
  get(threadTs: string): InterviewSession | undefined {
    return this.sessions.get(threadTs);
  }

  /**
   * Check if a session exists
   */
  has(threadTs: string): boolean {
    return this.sessions.has(threadTs);
  }

  /**
   * Update session phase
   */
  setPhase(threadTs: string, phase: InterviewPhase): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.phase = phase;
      this.touch(threadTs);
      console.log(`[InterviewStore] Session ${threadTs} phase: ${phase}`);
    }
  }

  /**
   * Set pending question for the session
   */
  setPendingQuestion(
    threadTs: string,
    questionData: QuestionData,
    toolUseId: string,
  ): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.pendingQuestion = questionData;
      session.pendingToolUseId = toolUseId;
      this.touch(threadTs);
      console.log(
        `[InterviewStore] Session ${threadTs} pending question: ${toolUseId}`,
      );
    }
  }

  /**
   * Clear pending question after answer
   */
  clearPendingQuestion(threadTs: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.pendingQuestion = undefined;
      session.pendingToolUseId = undefined;
    }
  }

  /**
   * Record an answer
   */
  recordAnswer(threadTs: string, header: string, answer: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.answers[header] = answer;
      this.touch(threadTs);
      console.log(
        `[InterviewStore] Session ${threadTs} answer recorded: ${header}`,
      );
    }
  }

  /**
   * Get answer payload for tool result
   */
  getAnswerPayload(threadTs: string): AnswerPayload | undefined {
    const session = this.sessions.get(threadTs);
    if (session?.pendingQuestion) {
      const payload: AnswerPayload = {};
      for (const question of session.pendingQuestion.questions) {
        const answer = session.answers[question.header];
        if (answer) {
          payload[question.header] = answer;
        }
      }
      return payload;
    }
    return undefined;
  }

  /**
   * Set Claude CLI handle for the session (local mode)
   */
  setClaudeHandle(
    threadTs: string,
    handle: InterviewSession["claudeHandle"],
  ): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.claudeHandle = handle;
    }
  }

  /**
   * Set worker ID for the session (distributed mode)
   */
  setWorkerId(threadTs: string, workerId: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.workerId = workerId;
      console.log(
        `[InterviewStore] Session ${threadTs} assigned to worker ${workerId}`,
      );
    }
  }

  /**
   * Get worker ID for the session
   */
  getWorkerId(threadTs: string): string | undefined {
    const session = this.sessions.get(threadTs);
    return session?.workerId;
  }

  /**
   * Set plan content
   */
  setPlanContent(threadTs: string, content: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.planContent = content;
      this.touch(threadTs);
    }
  }

  /**
   * Add Linear issue URL
   */
  addLinearIssueUrl(threadTs: string, url: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      if (!session.linearIssueUrls) {
        session.linearIssueUrls = [];
      }
      session.linearIssueUrls.push(url);
      this.touch(threadTs);
    }
  }

  /**
   * Set error message
   */
  setError(threadTs: string, message: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.errorMessage = message;
      session.phase = "error";
    }
  }

  /**
   * Check if user is the initiator
   */
  isInitiator(threadTs: string, userId: string): boolean {
    const session = this.sessions.get(threadTs);
    return session?.initiatorId === userId;
  }

  /**
   * Update last activity timestamp and reset timeout
   */
  touch(threadTs: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      session.lastActivityAt = new Date();
      this.resetTimeout(threadTs);
    }
  }

  /**
   * Close a session
   */
  close(threadTs: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      // Clear timeout
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer);
      }

      // Kill Claude handle if active
      if (session.claudeHandle) {
        try {
          session.claudeHandle.kill();
        } catch {
          // Ignore errors during cleanup
        }
      }

      this.sessions.delete(threadTs);
      console.log(`[InterviewStore] Closed session ${threadTs}`);
    }
  }

  /**
   * Close all sessions (for shutdown)
   */
  closeAll(): void {
    for (const threadTs of this.sessions.keys()) {
      this.close(threadTs);
    }
  }

  /**
   * Get all active sessions
   */
  getAll(): InterviewSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get session count
   */
  get count(): number {
    return this.sessions.size;
  }

  /**
   * Start timeout timer for a session
   */
  private startTimeout(threadTs: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.handleTimeout(threadTs);
    }, this.timeoutMs);
  }

  /**
   * Reset timeout timer for a session
   */
  private resetTimeout(threadTs: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer);
      }
      session.timeoutTimer = this.startTimeout(threadTs);
    }
  }

  /**
   * Handle session timeout
   */
  private handleTimeout(threadTs: string): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      console.log(`[InterviewStore] Session ${threadTs} timed out`);
      session.phase = "timed_out";

      // Emit timeout event (handled by the timeout callback set externally)
      // The close will be done by the handler after posting timeout message
    }
  }

  /**
   * Set a callback for session timeout
   */
  onTimeout(
    threadTs: string,
    callback: (session: InterviewSession) => void,
  ): void {
    const session = this.sessions.get(threadTs);
    if (session) {
      // Clear existing timeout
      if (session.timeoutTimer) {
        clearTimeout(session.timeoutTimer);
      }

      // Set new timeout with callback
      session.timeoutTimer = setTimeout(() => {
        const currentSession = this.sessions.get(threadTs);
        if (currentSession) {
          currentSession.phase = "timed_out";
          callback(currentSession);
        }
      }, this.timeoutMs);
    }
  }
}
