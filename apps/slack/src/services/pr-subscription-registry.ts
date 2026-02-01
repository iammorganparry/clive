/**
 * PR Subscription Registry
 *
 * Tracks PR → worker/session mappings so that GitHub review feedback
 * can be automatically routed to the originating worker for resolution.
 *
 * Lifecycle: subscription created on pr_created event, removed on PR merge/close.
 */

/**
 * PR subscription tracking a PR → worker/session mapping
 */
export interface PrSubscription {
  /** Full PR URL */
  prUrl: string;
  /** PR number */
  prNumber: number;
  /** Repository (owner/repo) */
  repo: string;
  /** Worker that created the PR */
  workerId: string;
  /** Claude CLI session ID for --resume */
  claudeSessionId: string;
  /** Project ID for worker routing */
  projectId: string;
  /** Slack channel for notifications */
  channel: string;
  /** Slack thread for notifications */
  threadTs: string;
  /** User who initiated the original session */
  initiatorId: string;
  /** When the subscription was created */
  subscribedAt: Date;
  /** Last time feedback was received */
  lastFeedbackAt?: Date;
}

/**
 * In-memory registry for PR subscriptions.
 * Keyed by "owner/repo#prNumber" for fast lookup from webhooks.
 */
export class PrSubscriptionRegistry {
  private subscriptions = new Map<string, PrSubscription>();

  /**
   * Generate lookup key from repo and PR number
   */
  private key(repo: string, prNumber: number): string {
    return `${repo.toLowerCase()}#${prNumber}`;
  }

  /**
   * Subscribe to PR feedback updates.
   * Called when a worker emits a pr_created event.
   */
  subscribe(subscription: Omit<PrSubscription, "subscribedAt">): void {
    const key = this.key(subscription.repo, subscription.prNumber);
    this.subscriptions.set(key, {
      ...subscription,
      subscribedAt: new Date(),
    });
    console.log(
      `[PrSubscriptionRegistry] Subscribed to ${subscription.repo}#${subscription.prNumber} (worker: ${subscription.workerId})`,
    );
  }

  /**
   * Unsubscribe from PR feedback (e.g., when PR is merged/closed).
   */
  unsubscribe(repo: string, prNumber: number): void {
    const key = this.key(repo, prNumber);
    const sub = this.subscriptions.get(key);
    if (sub) {
      this.subscriptions.delete(key);
      console.log(
        `[PrSubscriptionRegistry] Unsubscribed from ${repo}#${prNumber}`,
      );
    }
  }

  /**
   * Look up subscription by repo and PR number.
   * Used by the webhook handler to find where to route feedback.
   */
  getSubscription(repo: string, prNumber: number): PrSubscription | undefined {
    const key = this.key(repo, prNumber);
    return this.subscriptions.get(key);
  }

  /**
   * Get all subscriptions for a specific worker.
   */
  getSubscriptionsForWorker(workerId: string): PrSubscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.workerId === workerId,
    );
  }

  /**
   * Update the lastFeedbackAt timestamp for a subscription.
   */
  touchFeedback(repo: string, prNumber: number): void {
    const key = this.key(repo, prNumber);
    const sub = this.subscriptions.get(key);
    if (sub) {
      sub.lastFeedbackAt = new Date();
    }
  }

  /**
   * Get total subscription count (for debugging/monitoring).
   */
  get count(): number {
    return this.subscriptions.size;
  }

  /**
   * Clear all subscriptions (for shutdown).
   */
  closeAll(): void {
    this.subscriptions.clear();
  }
}
