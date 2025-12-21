/**
 * Deep Mock Drizzle DB client for testing
 *
 * This follows the pattern recommended in the Drizzle community:
 * https://www.answeroverflow.com/m/1135298272248995850
 *
 * Usage in test files:
 *
 * ```typescript
 * // Import the mock at the top of your test file (before any service imports)
 * import "../../__mocks__/drizzle-client.js";
 *
 * // Optionally import drizzleMock to set up specific return values:
 * import drizzleMock from "../../__mocks__/drizzle-client.js";
 *
 * // Then in your tests, mock the chainable methods:
 * drizzleMock.query.someTable.findFirst.mockResolvedValueOnce(mockData);
 * drizzleMock.insert.mockReturnValueOnce({
 *   values: vi.fn().mockReturnThis(),
 *   onConflictDoUpdate: vi.fn().mockReturnThis(),
 *   returning: vi.fn().mockResolvedValue([mockData]),
 * } as any);
 * ```
 */

import { type DeepMockProxy, mockDeep, mockReset } from "vitest-mock-extended";
import { beforeEach, vi } from "vitest";
import type { db } from "@clive/db/client";

export const drizzleMock: DeepMockProxy<typeof db> = mockDeep();

vi.mock("@clive/db/client", () => ({
  db: drizzleMock,
}));

beforeEach(() => {
  mockReset(drizzleMock);
});

export default drizzleMock;
