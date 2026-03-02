/**
 * Conductor Client
 *
 * HTTP client for communicating with the local Conductor service.
 * Posts orchestration requests and queries task status.
 */

export interface ConductorTask {
  id: string;
  state: string;
  prompt?: string;
  prUrl?: string;
  agents: Array<{ acpxSessionName: string; status: string }>;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConductorRequest {
  prompt?: string;
  linearIssueUrls?: string[];
  slackThread?: {
    channel: string;
    threadTs: string;
    initiatorId: string;
  };
}

export class ConductorClient {
  constructor(private readonly baseUrl: string = "http://localhost:3847") {}

  /** Submit a new orchestration request */
  async submitRequest(request: ConductorRequest): Promise<ConductorTask> {
    const response = await fetch(`${this.baseUrl}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Conductor request failed (${response.status}): ${error}`);
    }

    return response.json();
  }

  /** Get task status */
  async getStatus(taskId: string): Promise<ConductorTask | null> {
    const response = await fetch(`${this.baseUrl}/status/${taskId}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Status check failed (${response.status})`);
    }
    return response.json();
  }

  /** Cancel a task */
  async cancel(taskId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/cancel/${taskId}`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Cancel failed (${response.status})`);
    }
  }

  /** Check conductor health */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
