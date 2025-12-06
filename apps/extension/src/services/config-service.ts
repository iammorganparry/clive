import * as vscode from "vscode";

/**
 * Service for managing application configuration and API keys
 * Uses VSCode's SecretStorage API for encrypted storage
 */
export class ConfigService {
  constructor(private secrets: vscode.SecretStorage) {}

  /**
   * Get Anthropic API key with fallback priority:
   * 1. SecretStorage (backend-provided key)
   * 2. User workspace settings (for advanced users)
   */
  async getAnthropicApiKey(): Promise<string | undefined> {
    // 1. Try SecretStorage (backend-provided key)
    const storedKey = await this.secrets.get("clive.anthropic_api_key");
    if (storedKey) {
      return storedKey;
    }

    // 2. Fall back to user settings
    return vscode.workspace
      .getConfiguration("clive")
      .get<string>("anthropicApiKey");
  }

  /**
   * Store API keys in SecretStorage
   */
  async storeApiKeys(keys: { anthropicApiKey?: string }): Promise<void> {
    if (keys.anthropicApiKey) {
      await this.secrets.store("clive.anthropic_api_key", keys.anthropicApiKey);
    }
  }

  /**
   * Check if API key is configured (either from SecretStorage or settings)
   */
  async isConfigured(): Promise<boolean> {
    const apiKey = await this.getAnthropicApiKey();
    return !!apiKey && apiKey.length > 0;
  }

  /**
   * Clear stored API keys from SecretStorage
   * Note: This does not clear user settings
   */
  async clearApiKeys(): Promise<void> {
    await this.secrets.delete("clive.anthropic_api_key");
  }
}
