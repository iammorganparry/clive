import { describe, it, expect } from "vitest";
import { sectionRegistry, testAgentSectionOrder } from "../index.js";
import { SectionId } from "../../types.js";

describe("Section Registry", () => {
  describe("sectionRegistry", () => {
    it("should map all SectionId values to functions", () => {
      const allSectionIds = Object.values(SectionId);
      const registeredIds = Object.keys(sectionRegistry);

      // Verify all SectionIds are registered
      for (const id of allSectionIds) {
        expect(sectionRegistry).toHaveProperty(id);
        expect(typeof sectionRegistry[id]).toBe("function");
      }

      // Verify counts match
      expect(registeredIds.length).toBe(allSectionIds.length);
    });
  });

  describe("testAgentSectionOrder", () => {
    it("should contain no duplicate section IDs", () => {
      const uniqueIds = new Set(testAgentSectionOrder);
      expect(uniqueIds.size).toBe(testAgentSectionOrder.length);
    });

    it("should only contain registered section IDs", () => {
      for (const id of testAgentSectionOrder) {
        expect(sectionRegistry).toHaveProperty(id);
      }
    });
  });
});
