import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { z } from "zod";
import { createProcedureBuilder } from "../procedure.js";
import type { Procedure } from "../types.js";

describe("createProcedureBuilder", () => {
  it("should return builder with input method", () => {
    const builder = createProcedureBuilder<{ userId: string }>();
    expect(builder).toBeDefined();
    expect(typeof builder.input).toBe("function");
  });

  describe("query procedure", () => {
    it("should create query procedure with input schema", () => {
      const builder = createProcedureBuilder<{ userId: string }>();
      const schema = z.object({ id: z.string() });
      const handler = ({
        input,
      }: {
        input: z.infer<typeof schema>;
        ctx: { userId: string };
      }) => Effect.succeed({ result: `Query for ${input.id}` });

      const procedure = builder.input(schema).query(handler);

      expect(procedure).toBeDefined();
      expect(procedure._def.type).toBe("query");
      expect(procedure._def.input).toBe(schema);
      expect(procedure._def.handler).toBe(handler);
    });

    it("should create query procedure without input schema", () => {
      const builder = createProcedureBuilder<{ userId: string }>();
      const handler = ({ ctx }: { input: void; ctx: { userId: string } }) =>
        Effect.succeed({ result: "Query result" });

      // Note: This test assumes we can create procedures without input
      // If the API requires input, we'd need to use z.void() or similar
      const schema = z.void();
      const procedure = builder.input(schema).query(handler);

      expect(procedure._def.type).toBe("query");
      expect(procedure._def.handler).toBe(handler);
    });
  });

  describe("mutation procedure", () => {
    it("should create mutation procedure with input schema", () => {
      const builder = createProcedureBuilder<{ userId: string }>();
      const schema = z.object({ name: z.string(), age: z.number() });
      const handler = ({
        input,
      }: {
        input: z.infer<typeof schema>;
        ctx: { userId: string };
      }) => Effect.succeed({ created: true, id: "123" });

      const procedure = builder.input(schema).mutation(handler);

      expect(procedure).toBeDefined();
      expect(procedure._def.type).toBe("mutation");
      expect(procedure._def.input).toBe(schema);
      expect(procedure._def.handler).toBe(handler);
    });
  });

  describe("subscription procedure", () => {
    it("should create subscription procedure with input schema", async () => {
      const builder = createProcedureBuilder<{ userId: string }>();
      const schema = z.object({ topic: z.string() });
      const handler = async function* ({
        input,
        signal,
      }: {
        input: z.infer<typeof schema>;
        ctx: { userId: string };
        signal: AbortSignal;
        onProgress?: (data: unknown) => void;
      }) {
        yield { progress: 1 };
        yield { progress: 2 };
        return { complete: true };
      };

      const procedure = builder.input(schema).subscription(handler);

      expect(procedure).toBeDefined();
      expect(procedure._def.type).toBe("subscription");
      expect(procedure._def.input).toBe(schema);
      expect(procedure._def.handler).toBe(handler);

      // Test that the handler works as expected
      const generator = handler({
        input: { topic: "test" },
        ctx: { userId: "user123" },
        signal: new AbortController().signal,
      });

      const results = [];
      for await (const value of generator) {
        results.push(value);
      }

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ progress: 1 });
      expect(results[1]).toEqual({ progress: 2 });
    });
  });

  describe("procedure _def structure", () => {
    it("should contain correct type, input schema, and handler", () => {
      const builder = createProcedureBuilder<{ userId: string }>();
      const schema = z.object({ id: z.string() });
      const handler = ({
        input,
      }: {
        input: z.infer<typeof schema>;
        ctx: { userId: string };
      }) => Effect.succeed({ result: input.id });

      const procedure = builder.input(schema).query(handler) as Procedure<
        z.infer<typeof schema>,
        { result: string },
        { userId: string },
        "query"
      >;

      expect(procedure._def.type).toBe("query");
      expect(procedure._def.input).toBe(schema);
      expect(procedure._def.handler).toBe(handler);
      // Note: context is undefined in _def - it's provided at runtime when handler is called
    });
  });
});
