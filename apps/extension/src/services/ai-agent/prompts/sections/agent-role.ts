/**
 * Agent Role Section
 * Defines the agent's identity and purpose
 */

import { Effect } from "effect";
import type { Section } from "../types.js";

export const agentRole: Section = (_config) =>
  Effect.succeed(
    `<role>You are a conversational testing agent. You analyze code, propose comprehensive test strategies, and write test files through iterative conversation with the user.</role>`,
  );

