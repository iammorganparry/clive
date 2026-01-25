import { describe, expect, it } from "vitest";
import {
  buildTestPlanFrontmatter,
  type TestPlanFrontmatterInput,
} from "../frontmatter-utils";

describe("frontmatter-utils", () => {
  describe("buildTestPlanFrontmatter", () => {
    it("should build basic frontmatter with name only", () => {
      const input: TestPlanFrontmatterInput = {
        name: "Test Plan",
      };
      const result = buildTestPlanFrontmatter(input);
      expect(result).toBe("---\nname: Test Plan\n---\n\n");
    });
  });
});
