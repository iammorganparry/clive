/**
 * Unit tests for template interpolation
 */

import { describe, expect, it } from "vitest";
import { extractPlaceholders, resolveTemplate } from "../template-resolver.js";

describe("Template Resolver", () => {
  describe("resolveTemplate", () => {
    it("replaces single placeholder", () => {
      const template = "Hello {{NAME}}!";
      const placeholders = { NAME: "World" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Hello World!");
    });

    it("replaces multiple placeholders", () => {
      const template = "{{GREETING}} {{NAME}}! You are {{AGE}} years old.";
      const placeholders = {
        GREETING: "Hello",
        NAME: "Alice",
        AGE: "30",
      };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Hello Alice! You are 30 years old.");
    });

    it("leaves unmatched placeholders intact", () => {
      const template = "Hello {{NAME}}! Welcome to {{PLACE}}.";
      const placeholders = { NAME: "Bob" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Hello Bob! Welcome to {{PLACE}}.");
    });

    it("handles empty placeholder values", () => {
      const template = "Hello {{NAME}}!";
      const placeholders = { NAME: "" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Hello !");
    });

    it("handles placeholders with underscores", () => {
      const template = "{{AGENT_ROLE}} and {{USER_NAME}}";
      const placeholders = {
        AGENT_ROLE: "Testing Agent",
        USER_NAME: "Developer",
      };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Testing Agent and Developer");
    });

    it("handles template with no placeholders", () => {
      const template = "This is plain text.";
      const placeholders = { NAME: "Test" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("This is plain text.");
    });

    it("handles empty template", () => {
      const template = "";
      const placeholders = { NAME: "Test" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("");
    });

    it("handles whitespace around placeholder names", () => {
      const template = "{{NAME}} and {{AGE}}";
      const placeholders = { NAME: "Alice", AGE: "30" };
      const result = resolveTemplate(template, placeholders);
      expect(result).toBe("Alice and 30");
    });
  });

  describe("extractPlaceholders", () => {
    it("extracts single placeholder", () => {
      const template = "Hello {{NAME}}!";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual(["NAME"]);
    });

    it("extracts multiple placeholders", () => {
      const template = "{{GREETING}} {{NAME}}! You are {{AGE}}.";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual(["GREETING", "NAME", "AGE"]);
    });

    it("extracts unique placeholders only", () => {
      const template = "{{NAME}} is {{NAME}} years old.";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual(["NAME"]);
    });

    it("returns empty array for template with no placeholders", () => {
      const template = "This is plain text.";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual([]);
    });

    it("extracts placeholders with underscores", () => {
      const template = "{{AGENT_ROLE}} and {{USER_NAME}}";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual(["AGENT_ROLE", "USER_NAME"]);
    });

    it("handles empty template", () => {
      const template = "";
      const placeholders = extractPlaceholders(template);
      expect(placeholders).toEqual([]);
    });
  });
});
