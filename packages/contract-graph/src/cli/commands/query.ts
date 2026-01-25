/**
 * Query command - Look up contracts by file, contract ID, or criteria
 */

import type { Command } from "commander";
import pc from "picocolors";
import { loadContracts } from "../loader.js";
import { QueryEngine } from "../../query/engine.js";
import { formatLocation } from "../../graph/contract.js";

export function queryCommand(program: Command): void {
  program
    .command("query")
    .description("Query contracts by file path or contract ID")
    .option("-f, --file <path>", "Query contracts for a specific file")
    .option("-c, --contract <id>", "Get details for a specific contract")
    .option("-t, --type <type>", "Filter by contract type (function, event, table, etc.)")
    .option("-r, --repo <repo>", "Filter by repository")
    .option("--invariants", "Show only contracts with invariants")
    .option("--json", "Output as JSON")
    .option("-d, --dir <path>", "Directory containing contract files", ".")
    .action(async (options) => {
      const { graph, errors } = await loadContracts(options.dir);

      if (errors.length > 0) {
        for (const error of errors) {
          console.warn(pc.yellow("Warning:"), error.message);
        }
      }

      const engine = new QueryEngine(graph);

      // Query by file
      if (options.file) {
        const result = engine.contractsFor(options.file);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (result.contracts.length === 0) {
          console.log(pc.gray(`No contracts found for file: ${options.file}`));
          return;
        }

        console.log(pc.bold(`Contracts for ${options.file}:`));
        console.log();

        for (const contract of result.contracts) {
          printContract(contract);
        }

        if (result.invariants.length > 0) {
          console.log(pc.bold("Invariants:"));
          for (const inv of result.invariants) {
            const icon = inv.severity === "error" ? "🔴" : inv.severity === "warning" ? "🟡" : "🔵";
            console.log(`  ${icon} ${inv.description}`);
          }
          console.log();
        }

        if (result.errors.length > 0) {
          console.log(pc.bold("Possible Errors:"));
          for (const err of result.errors) {
            console.log(`  - ${err.name}${err.description ? `: ${err.description}` : ""}`);
          }
          console.log();
        }

        if (result.dependents.length > 0) {
          console.log(pc.bold(`Dependents (${result.dependents.length}):`));
          for (const dep of result.dependents) {
            console.log(`  - ${dep.id}`);
          }
        }

        return;
      }

      // Query by contract ID
      if (options.contract) {
        const contract = graph.getContract(options.contract);

        if (!contract) {
          console.error(pc.red(`Contract not found: ${options.contract}`));
          process.exit(1);
        }

        if (options.json) {
          console.log(JSON.stringify(contract, null, 2));
          return;
        }

        printContract(contract, true);
        return;
      }

      // General query with filters
      const query: Parameters<typeof engine.find>[0] = {};

      if (options.type) {
        query.type = options.type;
      }

      if (options.repo) {
        query.repo = options.repo;
      }

      if (options.invariants) {
        query.hasInvariants = true;
      }

      const contracts = engine.find(query);

      if (options.json) {
        console.log(JSON.stringify(contracts, null, 2));
        return;
      }

      if (contracts.length === 0) {
        console.log(pc.gray("No contracts found matching criteria"));
        return;
      }

      console.log(pc.bold(`Found ${contracts.length} contract(s):`));
      console.log();

      for (const contract of contracts) {
        printContract(contract);
      }
    });
}

function printContract(contract: ReturnType<typeof import("../../graph/contract.js").createContract>, detailed = false): void {
  console.log(pc.cyan(pc.bold(contract.id)));
  console.log(`  Type: ${contract.type}`);

  if (contract.location) {
    console.log(`  Location: ${formatLocation(contract.location)}`);
  }

  if (contract.version) {
    console.log(`  Version: ${contract.version}`);
  }

  if (detailed) {
    if (contract.schema) {
      console.log(`  Schema: ${JSON.stringify(contract.schema)}`);
    }

    if (contract.invariants.length > 0) {
      console.log(`  Invariants:`);
      for (const inv of contract.invariants) {
        const icon = inv.severity === "error" ? "🔴" : inv.severity === "warning" ? "🟡" : "🔵";
        console.log(`    ${icon} ${inv.description}`);
      }
    }

    if (contract.errors.length > 0) {
      console.log(`  Errors: ${contract.errors.map((e) => e.name).join(", ")}`);
    }

    if (contract.exposes.length > 0) {
      console.log(`  Exposes: ${contract.exposes.map((e) => `${e.method} ${e.path}`).join(", ")}`);
    }

    if (contract.publishes.length > 0) {
      console.log(`  Publishes: ${contract.publishes.join(", ")}`);
    }

    if (contract.consumes.length > 0) {
      console.log(`  Consumes: ${contract.consumes.join(", ")}`);
    }

    if (contract.reads.length > 0) {
      console.log(`  Reads: ${contract.reads.join(", ")}`);
    }

    if (contract.writes.length > 0) {
      console.log(`  Writes: ${contract.writes.join(", ")}`);
    }
  }

  console.log();
}
