import { describe, expect, it } from "vitest";
import { ApiUrls, Commands, GlobalStateKeys } from "../constants";

describe("Constants", () => {
  describe("ApiUrls", () => {
    it("should have valid dashboard and trpc URLs", () => {
      expect(ApiUrls.dashboard).toBe("http://localhost:3000");
      expect(ApiUrls.trpc).toBe("http://localhost:3000/api/trpc");
    });
  });

  describe("Commands", () => {
    it("should have acceptEdit command", () => {
      expect(Commands.acceptEdit).toBe("clive.acceptEdit");
    });

    it("should have rejectEdit command", () => {
      expect(Commands.rejectEdit).toBe("clive.rejectEdit");
    });
  });

  describe("GlobalStateKeys", () => {
    it("should have baseBranch key", () => {
      expect(GlobalStateKeys.baseBranch).toBe("clive.baseBranch");
    });
  });
});
