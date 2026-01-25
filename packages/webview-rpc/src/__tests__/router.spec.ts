import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRouter } from "../router.js";

describe("createRouter", () => {
  it("should return router and procedure helpers", () => {
    const { router, procedure } = createRouter<{ userId: string }>();

    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
    expect(procedure).toBeDefined();
    expect(procedure.input).toBeDefined();
  });

  it("should correctly compose nested routes", () => {
    const { router, procedure } = createRouter<{ userId: string }>();

    const userRouter = {
      get: procedure
        .input(z.object({ id: z.string() }))
        .query(({ input: _input }) =>
          Effect.succeed({ user: { id: _input.id } }),
        ),
      update: procedure
        .input(z.object({ id: z.string(), name: z.string() }))
        .mutation(({ input: _input }) => Effect.succeed({ updated: true })),
    };

    const appRouter = router({
      users: userRouter,
      posts: {
        list: procedure
          .input(z.void())
          .query(() => Effect.succeed({ posts: [] })),
      },
    });

    expect(appRouter).toBeDefined();
    expect(appRouter.users).toBeDefined();
    expect(appRouter.users.get).toBeDefined();
    expect(appRouter.users.update).toBeDefined();
    expect(appRouter.posts).toBeDefined();
    expect(appRouter.posts.list).toBeDefined();
  });

  it("should preserve procedure definitions", () => {
    const { router, procedure } = createRouter<{ userId: string }>();

    const testProcedure = procedure
      .input(z.object({ id: z.string() }))
      .query(({ input }) => Effect.succeed({ result: input.id }));

    const appRouter = router({
      test: testProcedure,
    });

    expect(appRouter.test).toBe(testProcedure);
    expect(appRouter.test._def.type).toBe("query");
    expect(appRouter.test._def.handler).toBeDefined();
  });

  it("should handle deeply nested routers", () => {
    const { router, procedure } = createRouter<{ userId: string }>();

    const nestedRouter = router({
      level1: {
        level2: {
          level3: {
            deep: procedure
              .input(z.object({ value: z.string() }))
              .query(({ input }) => Effect.succeed({ value: input.value })),
          },
        },
      },
    });

    expect(nestedRouter.level1).toBeDefined();
    expect(nestedRouter.level1.level2).toBeDefined();
    expect(nestedRouter.level1.level2.level3).toBeDefined();
    expect(nestedRouter.level1.level2.level3.deep).toBeDefined();
    expect(nestedRouter.level1.level2.level3.deep._def.type).toBe("query");
  });

  it("should support all procedure types in router", () => {
    const { router, procedure } = createRouter<{ userId: string }>();

    const mixedRouter = router({
      query: procedure
        .input(z.object({ id: z.string() }))
        .query(({ input }) => Effect.succeed({ id: input.id })),
      mutation: procedure
        .input(z.object({ name: z.string() }))
        .mutation(({ input }) => Effect.succeed({ created: true })),
      subscription: procedure
        .input(z.object({ topic: z.string() }))
        .subscription(async function* () {
          yield { progress: 1 };
          return { complete: true };
        }),
    });

    expect(mixedRouter.query._def.type).toBe("query");
    expect(mixedRouter.mutation._def.type).toBe("mutation");
    expect(mixedRouter.subscription._def.type).toBe("subscription");
  });
});
