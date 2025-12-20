import { DeepMockProxy, mockDeep, mockReset } from "vitest-mock-extended";
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
