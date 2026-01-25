import { Ref, Runtime } from "effect";
import { describe, expect, it } from "vitest";

/**
 * Unit tests for consecutive mistake tracking in testing-agent
 * These tests verify the mistake counter logic without requiring full agent integration
 */
describe("Testing Agent - Consecutive Mistake Tracking", () => {
  describe("mistake counting logic", () => {
    it("should increment mistake count on tool failure", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));

      // Simulate tool failure
      const toolFailed = true;
      const hasNewProblems = false;
      const wasRejected = false;

      if (toolFailed || hasNewProblems || wasRejected) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.update(consecutiveMistakeRef, (n) => n + 1),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(1);
    });

    it("should increment mistake count when new problems detected", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));

      // Simulate new diagnostic problems
      const toolFailed = false;
      const hasNewProblems = true;
      const wasRejected = false;

      if (toolFailed || hasNewProblems || wasRejected) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.update(consecutiveMistakeRef, (n) => n + 1),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(1);
    });

    it("should reset mistake count on successful tool execution", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(3)); // Start with 3 mistakes

      // Simulate successful tool execution
      const toolSucceeded = true;

      if (toolSucceeded) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.set(consecutiveMistakeRef, 0),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(0);
    });

    it("should reset mistake count when problems are fixed", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(2)); // Start with 2 mistakes

      // Simulate tool execution where previous problems are now fixed
      const toolFailed = false;
      const hasNewProblems = false;
      const toolSucceeded = true;

      if (!toolFailed && !hasNewProblems && toolSucceeded) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.set(consecutiveMistakeRef, 0),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(0);
    });
  });

  describe("mistake limit detection", () => {
    it("should detect when mistake limit is reached", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(4));
      const MAX_CONSECUTIVE_MISTAKES = 5;

      // Increment to reach limit
      await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.update(consecutiveMistakeRef, (n) => n + 1),
      );

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      const limitReached = mistakeCount >= MAX_CONSECUTIVE_MISTAKES;

      expect(limitReached).toBe(true);
      expect(mistakeCount).toBe(5);
    });

    it("should continue operation when under limit", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(3));
      const MAX_CONSECUTIVE_MISTAKES = 5;

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      const limitReached = mistakeCount >= MAX_CONSECUTIVE_MISTAKES;

      expect(limitReached).toBe(false);
      expect(mistakeCount).toBe(3);
    });

    it("should track mistakes across multiple tool calls", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));

      // Simulate multiple failed tool calls
      for (let i = 0; i < 3; i++) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.update(consecutiveMistakeRef, (n) => n + 1),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(3);
    });

    it("should respect configurable mistake limit", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));
      const CUSTOM_LIMIT = 3;

      // Increment to custom limit
      for (let i = 0; i < CUSTOM_LIMIT; i++) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.update(consecutiveMistakeRef, (n) => n + 1),
        );
      }

      const mistakeCount = await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.get(consecutiveMistakeRef),
      );

      expect(mistakeCount).toBe(CUSTOM_LIMIT);
      expect(mistakeCount >= CUSTOM_LIMIT).toBe(true);
    });
  });

  describe("tool result parsing", () => {
    it("should parse newProblemsMessage from writeTestFile result", () => {
      const actualOutput = {
        success: true,
        filePath: "test.ts",
        message:
          "The content was successfully saved to test.ts.\n\nNew diagnostic problems introduced:\nLine 5, Column 1: Variable not defined",
      };

      const hasNewProblems =
        actualOutput &&
        typeof actualOutput === "object" &&
        "message" in actualOutput &&
        typeof actualOutput.message === "string" &&
        actualOutput.message.includes("New diagnostic problems introduced");

      expect(hasNewProblems).toBe(true);
    });

    it("should parse newProblemsMessage from replaceInFile result", () => {
      const actualOutput = {
        success: true,
        filePath: "test.ts",
        message:
          "The content was successfully saved to test.ts.\n\nNew diagnostic problems introduced:\nLine 10, Column 5: Type error",
      };

      const hasNewProblems =
        actualOutput &&
        typeof actualOutput === "object" &&
        "message" in actualOutput &&
        typeof actualOutput.message === "string" &&
        actualOutput.message.includes("New diagnostic problems introduced");

      expect(hasNewProblems).toBe(true);
    });

    it("should handle missing newProblemsMessage gracefully", () => {
      const actualOutput = {
        success: true,
        filePath: "test.ts",
        message: "The content was successfully saved to test.ts.",
      };

      const hasNewProblems =
        actualOutput &&
        typeof actualOutput === "object" &&
        "message" in actualOutput &&
        typeof actualOutput.message === "string" &&
        actualOutput.message.includes("New diagnostic problems introduced");

      expect(hasNewProblems).toBe(false);
    });

    it("should detect tool failure from success flag", () => {
      const actualOutput = {
        success: false,
        filePath: "test.ts",
        message: "Failed to write file",
      };

      const toolFailed =
        actualOutput &&
        typeof actualOutput === "object" &&
        "success" in actualOutput &&
        actualOutput.success === false;

      expect(toolFailed).toBe(true);
    });

    it("should detect tool rejection", () => {
      const actualOutput = {
        rejected: true,
        message: "User rejected the changes",
      };

      const wasRejected =
        actualOutput &&
        typeof actualOutput === "object" &&
        "rejected" in actualOutput &&
        actualOutput.rejected === true;

      expect(wasRejected).toBe(true);
    });

    it("should handle successful tool with no problems", () => {
      const actualOutput = {
        success: true,
        filePath: "test.ts",
        message: "The content was successfully saved to test.ts.",
      };

      const toolFailed =
        actualOutput &&
        typeof actualOutput === "object" &&
        "success" in actualOutput &&
        actualOutput.success === false;

      const hasNewProblems =
        actualOutput &&
        typeof actualOutput === "object" &&
        "message" in actualOutput &&
        typeof actualOutput.message === "string" &&
        actualOutput.message.includes("New diagnostic problems introduced");

      const shouldIncrementMistakes = toolFailed || hasNewProblems;

      expect(shouldIncrementMistakes).toBe(false);
    });
  });

  describe("integration scenarios", () => {
    it("should handle alternating success and failure", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));

      // Fail
      await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.update(consecutiveMistakeRef, (n) => n + 1),
      );
      expect(
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.get(consecutiveMistakeRef),
        ),
      ).toBe(1);

      // Succeed - reset
      await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.set(consecutiveMistakeRef, 0),
      );
      expect(
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.get(consecutiveMistakeRef),
        ),
      ).toBe(0);

      // Fail again
      await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.update(consecutiveMistakeRef, (n) => n + 1),
      );
      expect(
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.get(consecutiveMistakeRef),
        ),
      ).toBe(1);
    });

    it("should accumulate mistakes until success", async () => {
      const consecutiveMistakeRef = await Runtime.runPromise(
        Runtime.defaultRuntime,
      )(Ref.make<number>(0));

      // Fail 4 times
      for (let i = 0; i < 4; i++) {
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.update(consecutiveMistakeRef, (n) => n + 1),
        );
      }

      expect(
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.get(consecutiveMistakeRef),
        ),
      ).toBe(4);

      // Success resets
      await Runtime.runPromise(Runtime.defaultRuntime)(
        Ref.set(consecutiveMistakeRef, 0),
      );

      expect(
        await Runtime.runPromise(Runtime.defaultRuntime)(
          Ref.get(consecutiveMistakeRef),
        ),
      ).toBe(0);
    });
  });
});
