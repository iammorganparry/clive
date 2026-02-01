import { createAppAuth } from "@octokit/auth-app";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  installationId: number;
}

export class GitHubAppAuth {
  private auth: ReturnType<typeof createAppAuth>;
  private cachedToken: { token: string; expiresAt: Date } | null = null;

  constructor(config: GitHubAppConfig) {
    this.auth = createAppAuth({
      appId: config.appId,
      privateKey: config.privateKey,
      installationId: config.installationId,
    });
  }

  /** Get a valid installation token, auto-refreshing when near expiry */
  async getToken(): Promise<string> {
    // Refresh 5 min before expiry
    if (
      this.cachedToken &&
      this.cachedToken.expiresAt > new Date(Date.now() + 5 * 60 * 1000)
    ) {
      return this.cachedToken.token;
    }
    const result = await this.auth({ type: "installation" });
    this.cachedToken = {
      token: result.token,
      expiresAt: new Date(result.expiresAt),
    };
    return result.token;
  }
}
