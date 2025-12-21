import { vi } from "vitest";

/**
 * Mock AI SDK embed function for testing
 */
export const mockEmbed = vi.fn().mockResolvedValue({
  embedding: Array(1536)
    .fill(0)
    .map(() => Math.random() * 2 - 1), // Random values between -1 and 1
});

/**
 * Mock createOpenAI function
 */
export const mockCreateOpenAI = vi.fn().mockReturnValue({
  embedding: vi.fn().mockReturnValue("text-embedding-3-small"),
});
