/**
 * Test command execution
 * Verify CliManager can execute commands and emit events
 */

import { CliManager } from "./services/CliManager";

async function testExecution() {
  console.log("Creating CliManager...");
  const manager = new CliManager();

  console.log("Setting up listeners...");
  manager.on("output", (line) => {
    console.log(`[OUTPUT:${line.type}]`, line.text.substring(0, 100));
  });

  manager.on("complete", () => {
    console.log("[COMPLETE] Execution finished");
    process.exit(0);
  });

  console.log("Starting execution with test prompt...");
  try {
    await manager.execute("What is 2+2? Answer briefly.", {
      workspaceRoot: process.cwd(),
      model: "sonnet",
    });
  } catch (error) {
    console.error("[ERROR]", error);
    process.exit(1);
  }
}

testExecution();
