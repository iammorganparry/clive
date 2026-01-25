/**
 * Docs command - Generate markdown documentation from contracts
 */

import type { Command } from "commander";
import pc from "picocolors";
import { loadContracts } from "../loader.js";
import { generateMarkdownDocs, generateClaudeMd } from "../../generators/markdown.js";
import { writeFile } from "node:fs/promises";

export function docsCommand(program: Command): void {
  program
    .command("docs")
    .description("Generate documentation from contracts")
    .option("-d, --dir <path>", "Directory containing contract files", ".")
    .option("-o, --output <path>", "Output file path", "./docs/contracts.md")
    .option("--claude", "Generate CLAUDE.md format for AI agents")
    .option("--stdout", "Output to stdout instead of file")
    .action(async (options) => {
      const { graph, errors } = await loadContracts(options.dir);

      if (errors.length > 0) {
        for (const error of errors) {
          console.warn(pc.yellow("Warning:"), error.message);
        }
      }

      let content: string;
      if (options.claude) {
        content = generateClaudeMd(graph);
      } else {
        content = generateMarkdownDocs(graph);
      }

      if (options.stdout) {
        console.log(content);
      } else {
        await writeFile(options.output, content, "utf-8");
        console.log(pc.green(`✓ Documentation written to ${options.output}`));
      }
    });
}
