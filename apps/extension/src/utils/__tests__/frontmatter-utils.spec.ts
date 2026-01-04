import { describe, it, expect } from "vitest";
import {
  buildTestPlanFrontmatter,
  buildFullPlanContent,
  parseFrontmatter,
  generateFrontmatter,
  isPlanStatus,
  type TestPlanFrontmatterInput,
  type TestPlanSuite,
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
