import {
  createMockDrizzleClient,
  type DeepMockProxy,
} from "../__tests__/test-layer-factory.js";
import type { DrizzleClient } from "../services/drizzle-db.js";

// Create a singleton mock for backward compatibility
export const drizzleMock: DeepMockProxy<DrizzleClient> =
  createMockDrizzleClient();

export default drizzleMock;
