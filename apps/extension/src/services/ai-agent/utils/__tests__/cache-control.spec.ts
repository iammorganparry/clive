import { describe, expect, it } from "vitest";
import { addCacheControlToMessages } from "../cache-control.js";
import type { LanguageModel } from "ai";

describe("cache-control", () => {
  describe("addCacheControlToMessages", () => {
    describe("empty messages array", () => {
      it("should return empty array for empty input", () => {
        const messages: Array<{
          role: "user" | "assistant" | "system";
          content: string;
        }> = [];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toEqual([]);
      });
    });

    describe("non-Anthropic models", () => {
      it("should pass through messages unchanged for OpenAI model", () => {
        const messages = [
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi there" },
        ];
        const model: LanguageModel = {
          provider: "openai",
          modelId: "gpt-4",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toEqual(messages);
        expect(result[0]).not.toHaveProperty("providerOptions");
        expect(result[1]).not.toHaveProperty("providerOptions");
      });

      it("should pass through messages unchanged for generic model", () => {
        const messages = [
          { role: "user" as const, content: "Test message" },
        ];
        const model: LanguageModel = {
          provider: "google",
          modelId: "gemini-pro",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toEqual(messages);
        expect(result[0]).not.toHaveProperty("providerOptions");
      });

      it("should handle string model that is not Anthropic", () => {
        const messages = [
          { role: "user" as const, content: "Hello" },
        ];
        const model = "openai:gpt-4" as unknown as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toEqual(messages);
        expect(result[0]).not.toHaveProperty("providerOptions");
      });
    });

    describe("Anthropic models - provider detection", () => {
      it("should add cache control to last message when provider is 'anthropic'", () => {
        const messages = [
          { role: "user" as const, content: "First message" },
          { role: "assistant" as const, content: "Second message" },
          { role: "user" as const, content: "Third message" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toHaveLength(3);
        expect(result[0]).not.toHaveProperty("providerOptions");
        expect(result[1]).not.toHaveProperty("providerOptions");
        expect(result[2]).toHaveProperty("providerOptions");
        expect(result[2].providerOptions).toEqual({
          anthropic: { cacheControl: { type: "ephemeral" } },
        });
      });

      it("should detect Anthropic when provider contains 'anthropic'", () => {
        const messages = [
          { role: "user" as const, content: "Message" },
        ];
        const model: LanguageModel = {
          provider: "custom-anthropic-proxy",
          modelId: "claude-3-opus",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0]).toHaveProperty("providerOptions");
        expect(result[0].providerOptions?.anthropic?.cacheControl).toEqual({
          type: "ephemeral",
        });
      });
    });

    describe("Anthropic models - modelId detection", () => {
      it("should detect Anthropic when modelId contains 'claude'", () => {
        const messages = [
          { role: "user" as const, content: "Test" },
        ];
        const model: LanguageModel = {
          provider: "custom-provider",
          modelId: "claude-3-5-sonnet",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0]).toHaveProperty("providerOptions");
        expect(result[0].providerOptions?.anthropic?.cacheControl).toEqual({
          type: "ephemeral",
        });
      });

      it("should detect Anthropic when modelId contains 'anthropic'", () => {
        const messages = [
          { role: "user" as const, content: "Test" },
        ];
        const model: LanguageModel = {
          provider: "custom-provider",
          modelId: "anthropic-model-v1",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0]).toHaveProperty("providerOptions");
        expect(result[0].providerOptions?.anthropic?.cacheControl).toEqual({
          type: "ephemeral",
        });
      });

      it("should detect Anthropic from string model with 'claude'", () => {
        const messages = [
          { role: "user" as const, content: "Test" },
        ];
        const model = "claude-3-opus" as unknown as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0]).toHaveProperty("providerOptions");
        expect(result[0].providerOptions?.anthropic?.cacheControl).toEqual({
          type: "ephemeral",
        });
      });

      it("should detect Anthropic from string model with 'anthropic'", () => {
        const messages = [
          { role: "user" as const, content: "Test" },
        ];
        const model = "anthropic/claude-3" as unknown as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0]).toHaveProperty("providerOptions");
        expect(result[0].providerOptions?.anthropic?.cacheControl).toEqual({
          type: "ephemeral",
        });
      });
    });

    describe("single message array", () => {
      it("should add cache control to single message for Anthropic model", () => {
        const messages = [
          { role: "user" as const, content: "Single message" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toHaveLength(1);
        expect(result[0].role).toBe("user");
        expect(result[0].content).toBe("Single message");
        expect(result[0].providerOptions).toEqual({
          anthropic: { cacheControl: { type: "ephemeral" } },
        });
      });
    });

    describe("multiple messages - only last gets cache control", () => {
      it("should only add cache control to the last message", () => {
        const messages = [
          { role: "system" as const, content: "You are a helpful assistant" },
          { role: "user" as const, content: "What is 2+2?" },
          { role: "assistant" as const, content: "4" },
          { role: "user" as const, content: "Thanks!" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toHaveLength(4);
        
        // First three messages should not have cache control
        expect(result[0]).not.toHaveProperty("providerOptions");
        expect(result[0].role).toBe("system");
        expect(result[0].content).toBe("You are a helpful assistant");

        expect(result[1]).not.toHaveProperty("providerOptions");
        expect(result[1].role).toBe("user");
        expect(result[1].content).toBe("What is 2+2?");

        expect(result[2]).not.toHaveProperty("providerOptions");
        expect(result[2].role).toBe("assistant");
        expect(result[2].content).toBe("4");

        // Last message should have cache control
        expect(result[3]).toHaveProperty("providerOptions");
        expect(result[3].role).toBe("user");
        expect(result[3].content).toBe("Thanks!");
        expect(result[3].providerOptions).toEqual({
          anthropic: { cacheControl: { type: "ephemeral" } },
        });
      });

      it("should preserve message properties while adding cache control", () => {
        const messages = [
          { role: "user" as const, content: "Message 1", id: "msg-1" },
          { role: "assistant" as const, content: "Message 2", id: "msg-2" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-opus",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({ role: "user", content: "Message 1", id: "msg-1" });
        expect(result[1]).toMatchObject({
          role: "assistant",
          content: "Message 2",
          id: "msg-2",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        });
      });
    });

    describe("edge cases", () => {
      it("should work with all message role types", () => {
        const systemMessages = [
          { role: "system" as const, content: "System prompt" },
        ];
        const userMessages = [
          { role: "user" as const, content: "User message" },
        ];
        const assistantMessages = [
          { role: "assistant" as const, content: "Assistant message" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const systemResult = addCacheControlToMessages(systemMessages, model);
        const userResult = addCacheControlToMessages(userMessages, model);
        const assistantResult = addCacheControlToMessages(assistantMessages, model);

        expect(systemResult[0].providerOptions).toBeDefined();
        expect(userResult[0].providerOptions).toBeDefined();
        expect(assistantResult[0].providerOptions).toBeDefined();
      });

      it("should handle messages with empty content", () => {
        const messages = [
          { role: "user" as const, content: "" },
        ];
        const model: LanguageModel = {
          provider: "anthropic",
          modelId: "claude-3-5-sonnet-20241022",
        } as LanguageModel;

        const result = addCacheControlToMessages(messages, model);

        expect(result[0].content).toBe("");
        expect(result[0].providerOptions).toBeDefined();
      });
    });
  });
});
