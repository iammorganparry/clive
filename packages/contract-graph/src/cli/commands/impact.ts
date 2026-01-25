/**
 * Impact command - Analyze the impact of changing a contract
 */

import type { Command } from "commander";
import pc from "picocolors";
import { loadContracts } from "../loader.js";
import { QueryEngine } from "../../query/engine.js";
import { formatLocation } from "../../graph/contract.js";

export function impactCommand(program: Command): void {
  program
    .command("impact <contractId>")
    .description("Analyze the impact of changing a contract")
    .option("-d, --dir <path>", "Directory containing contract files", ".")
    .option("--max-depth <n>", "Maximum depth for transitive analysis", "10")
    .option("--no-cross-repo", "Exclude cross-repository impacts")
    .option("--json", "Output as JSON")
    .action(async (contractId, options) => {
      const { graph, errors } = await loadContracts(options.dir);

      if (errors.length > 0) {
        for (const error of errors) {
          console.warn(pc.yellow("Warning:"), error.message);
        }
      }

      const engine = new QueryEngine(graph);
      const impact = engine.impactOf(contractId, {
        maxDepth: parseInt(options.maxDepth, 10),
        includeCrossRepo: options.crossRepo !== false,
      });

      if (!impact) {
        console.error(pc.red(`Contract not found: ${contractId}`));
        process.exit(1);
      }

      if (options.json) {
        // Convert Map to object for JSON serialization
        const jsonImpact = {
          ...impact,
          crossRepoImpacts: Object.fromEntries(impact.crossRepoImpacts),
        };
        console.log(JSON.stringify(jsonImpact, null, 2));
        return;
      }

      // Header
      console.log(pc.bold(pc.cyan(`Impact Analysis: ${impact.contract.id}`)));
      console.log(pc.gray("─".repeat(50)));
      console.log();

      // Contract info
      console.log(`${pc.bold("Type:")} ${impact.contract.type}`);
      if (impact.contract.location) {
        console.log(`${pc.bold("Location:")} ${formatLocation(impact.contract.location)}`);
      }
      if (impact.contract.repo) {
        console.log(`${pc.bold("Repository:")} ${impact.contract.repo}`);
      }
      if (impact.contract.schema) {
        console.log(`${pc.bold("Schema:")} ${JSON.stringify(impact.contract.schema)}`);
      }
      console.log();

      // Warnings
      if (impact.warnings.length > 0) {
        console.log(pc.bold(pc.yellow("Warnings:")));
        for (const warning of impact.warnings) {
          console.log(`  ${warning}`);
        }
        console.log();
      }

      // Producers
      if (impact.producers.length > 0) {
        console.log(pc.bold(`Producers (${impact.producers.length}):`));
        for (const producer of impact.producers) {
          const loc = producer.location ? pc.gray(` @ ${formatLocation(producer.location)}`) : "";
          const repo = producer.repo ? pc.blue(` [${producer.repo}]`) : "";
          console.log(`  - ${producer.id}${loc}${repo}`);
        }
        console.log();
      }

      // Consumers
      if (impact.consumers.length > 0) {
        console.log(pc.bold(`Consumers (${impact.consumers.length}):`));
        for (const consumer of impact.consumers) {
          const loc = consumer.location ? pc.gray(` @ ${formatLocation(consumer.location)}`) : "";
          const repo = consumer.repo ? pc.blue(` [${consumer.repo}]`) : "";
          console.log(`  - ${consumer.id}${loc}${repo}`);

          for (const inv of consumer.invariants) {
            const icon = inv.severity === "error" ? pc.red("●") : pc.yellow("●");
            console.log(`    ${icon} ${inv.description}`);
          }
        }
        console.log();
      }

      // Direct dependents
      if (impact.directDependents.length > 0) {
        console.log(pc.bold(`Direct Dependents (${impact.directDependents.length}):`));
        for (const dep of impact.directDependents) {
          const loc = dep.location ? pc.gray(` @ ${formatLocation(dep.location)}`) : "";
          console.log(`  - ${dep.id}${loc}`);
        }
        console.log();
      }

      // Transitive dependents (excluding direct)
      const transitiveOnly = impact.transitiveDependents.filter(
        (t) => !impact.directDependents.some((d) => d.id === t.id)
      );
      if (transitiveOnly.length > 0) {
        console.log(pc.bold(`Transitive Dependents (${transitiveOnly.length}):`));
        for (const dep of transitiveOnly.slice(0, 10)) {
          console.log(`  - ${dep.id}`);
        }
        if (transitiveOnly.length > 10) {
          console.log(pc.gray(`  ... and ${transitiveOnly.length - 10} more`));
        }
        console.log();
      }

      // Cross-repo impacts
      if (impact.crossRepoImpacts.size > 0) {
        console.log(pc.bold(pc.red("Cross-Repository Impacts:")));
        for (const [repo, contracts] of impact.crossRepoImpacts) {
          console.log(`  ${pc.blue(repo)}:`);
          for (const contract of contracts) {
            console.log(`    - ${contract.id}`);
          }
        }
        console.log();
      }

      // Invariants to maintain
      if (impact.invariantsToMaintain.length > 0) {
        console.log(pc.bold("Invariants to Maintain:"));
        for (const inv of impact.invariantsToMaintain) {
          const icon =
            inv.severity === "error"
              ? pc.red("●")
              : inv.severity === "warning"
                ? pc.yellow("●")
                : pc.blue("●");
          console.log(`  ${icon} ${inv.description}`);
        }
        console.log();
      }

      // Summary
      console.log(pc.gray("─".repeat(50)));
      console.log(
        pc.bold("Summary:"),
        `${impact.directDependents.length} direct,`,
        `${impact.transitiveDependents.length} total dependents,`,
        `${impact.crossRepoImpacts.size} cross-repo impacts`
      );
    });
}
