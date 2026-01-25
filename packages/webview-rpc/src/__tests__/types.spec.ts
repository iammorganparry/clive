import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isZodSchema } from "../types.js";

describe("isZodSchema", () => {
  it("should correctly identify Zod schemas", () => {
    const stringSchema = z.string();
    const numberSchema = z.number();
    const objectSchema = z.object({ name: z.string() });
    const arraySchema = z.array(z.string());

    expect(isZodSchema(stringSchema)).toBe(true);
    expect(isZodSchema(numberSchema)).toBe(true);
    expect(isZodSchema(objectSchema)).toBe(true);
    expect(isZodSchema(arraySchema)).toBe(true);
  });

  it("should reject non-schema objects", () => {
    expect(isZodSchema({})).toBe(false);
    expect(isZodSchema({ name: "test" })).toBe(false);
    expect(isZodSchema([])).toBe(false);
    expect(isZodSchema("string")).toBe(false);
    expect(isZodSchema(123)).toBe(false);
    expect(isZodSchema(true)).toBe(false);
  });

  it("should handle edge cases", () => {
    expect(isZodSchema(null)).toBe(false);
    expect(isZodSchema(undefined)).toBe(false);
  });

  it("should reject objects without safeParse method", () => {
    const fakeSchema = {
      parse: () => {},
    };
    expect(isZodSchema(fakeSchema)).toBe(false);
  });

  it("should reject objects with safeParse that is not a function", () => {
    const fakeSchema = {
      safeParse: "not a function",
    };
    expect(isZodSchema(fakeSchema)).toBe(false);
  });

  it("should accept objects with safeParse function even if not Zod", () => {
    const mockSchema = {
      safeParse: (data: unknown) => ({
        success: true,
        data,
      }),
    };
    // This should pass because it has the right shape
    expect(isZodSchema(mockSchema)).toBe(true);
  });
});
