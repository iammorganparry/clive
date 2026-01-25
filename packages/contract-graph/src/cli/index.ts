#!/usr/bin/env node

/**
 * Contract Graph CLI
 * Command-line interface for querying and validating contracts
 */

import { Command } from "commander";
import pc from "picocolors";
import { queryCommand } from "./commands/query.js";
import { impactCommand } from "./commands/impact.js";
import { validateCommand } from "./commands/validate.js";
import { docsCommand } from "./commands/docs.js";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("contract-graph")
  .description("AI-aware contract testing framework using Mermaid-based contract definitions")
  .version("0.1.0");

// Register commands
queryCommand(program);
impactCommand(program);
validateCommand(program);
docsCommand(program);
initCommand(program);

// Global error handling
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof Error && err.message.includes("commander")) {
    // Commander error (help requested, version, etc.)
    process.exit(0);
  }
  console.error(pc.red("Error:"), err instanceof Error ? err.message : String(err));
  process.exit(1);
}
