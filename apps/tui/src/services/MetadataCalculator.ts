/**
 * MetadataCalculator
 * Calculates token costs and formats metadata for display
 * Ported from apps/tui-go cost calculation logic
 */

export interface TokenMetadata {
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
  costUSD?: number;
}

export class MetadataCalculator {
  // Model pricing per 1M tokens (as of January 2025)
  private static readonly PRICING: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
    'claude-opus-4-5': { input: 15.0, output: 75.0 },
    'claude-opus-4': { input: 15.0, output: 75.0 },
    'claude-haiku-3-5': { input: 0.8, output: 4.0 },
    'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
    'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
  };

  /**
   * Calculate cost in USD for given token usage
   */
  static calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = this.PRICING[model];
    if (!pricing) {
      // Unknown model, return 0
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Get cost color for display (red = expensive, yellow = moderate, gray = cheap)
   */
  static getCostColor(costUSD: number): string {
    if (costUSD > 0.10) return '#E06C75'; // Red
    if (costUSD > 0.01) return '#E5C07B'; // Yellow
    return '#5C6370'; // Gray (muted)
  }

  /**
   * Format cost for display
   */
  static formatCost(costUSD: number): string {
    if (costUSD < 0.0001) {
      return '<$0.0001';
    }
    return `$${costUSD.toFixed(4)}`;
  }

  /**
   * Format duration in milliseconds to human readable
   */
  static formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    const seconds = (ms / 1000).toFixed(1);
    return `${seconds}s`;
  }

  /**
   * Format token counts for display
   */
  static formatTokens(inputTokens?: number, outputTokens?: number): string {
    if (!inputTokens && !outputTokens) return '';

    const parts: string[] = [];
    if (inputTokens) parts.push(`↓${inputTokens}`);
    if (outputTokens) parts.push(`↑${outputTokens}`);

    return parts.join('/');
  }
}
