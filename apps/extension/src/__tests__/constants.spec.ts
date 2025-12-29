import { describe, expect, it } from "vitest";
import {
  ApiUrls,
  Commands,
  ConfigFile,
  GlobalStateKeys,
  IndexingConfig,
  KnowledgeBaseCategorySchema,
  LoggerConfig,
  SecretKeys,
  SuggestedKnowledgeCategories,
  Views,
  WebviewMessages,
} from "../constants";

describe("Constants", () => {
  describe("ApiUrls", () => {
    it("should have valid dashboard and trpc URLs", () => {
      expect(ApiUrls.dashboard).toBe("http://localhost:3000");
      expect(ApiUrls.trpc).toBe("http://localhost:3000/api/trpc");
    });
  });
});
