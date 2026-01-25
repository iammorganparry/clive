/**
 * Markdown Generator - Generate documentation from contracts
 */

import type { Contract } from "../graph/contract.js";
import { formatLocation } from "../graph/contract.js";
import type { ContractGraph } from "../graph/graph.js";
import { describeRelationship } from "../graph/relationship.js";

/**
 * Generate full markdown documentation from contracts
 */
export function generateMarkdownDocs(graph: ContractGraph): string {
  const lines: string[] = [];
  const contracts = graph.getAllContracts();
  const relationships = graph.getAllRelationships();

  lines.push("# System Contracts Documentation");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total Contracts**: ${contracts.length}`);
  lines.push(`- **Total Relationships**: ${relationships.length}`);
  lines.push("");

  // Group by type
  const byType = groupBy(contracts, (c) => c.type);

  for (const [type, typeContracts] of Object.entries(byType)) {
    lines.push(`## ${capitalize(type)}s`);
    lines.push("");

    for (const contract of typeContracts) {
      lines.push(`### ${contract.id}`);
      lines.push("");

      if (contract.location) {
        lines.push(`**Location**: \`${formatLocation(contract.location)}\``);
        lines.push("");
      }

      if (contract.version) {
        lines.push(`**Version**: ${contract.version}`);
        lines.push("");
      }

      if (contract.schema) {
        lines.push("**Schema**:");
        lines.push("```json");
        lines.push(JSON.stringify(contract.schema, null, 2));
        lines.push("```");
        lines.push("");
      }

      if (contract.exposes.length > 0) {
        lines.push("**Endpoints**:");
        for (const endpoint of contract.exposes) {
          lines.push(`- \`${endpoint.method} ${endpoint.path}\``);
        }
        lines.push("");
      }

      if (contract.invariants.length > 0) {
        lines.push("**Invariants**:");
        for (const inv of contract.invariants) {
          const icon = inv.severity === "error" ? "🔴" : inv.severity === "warning" ? "🟡" : "🔵";
          lines.push(`- ${icon} ${inv.description}`);
        }
        lines.push("");
      }

      if (contract.errors.length > 0) {
        lines.push("**Possible Errors**:");
        for (const err of contract.errors) {
          lines.push(`- \`${err.name}\`${err.description ? `: ${err.description}` : ""}`);
        }
        lines.push("");
      }

      // Dependencies
      const outgoing = graph.getOutgoing(contract.id);
      if (outgoing.length > 0) {
        lines.push("**Dependencies**:");
        for (const rel of outgoing) {
          lines.push(`- ${describeRelationship(rel.type)} \`${rel.to}\``);
        }
        lines.push("");
      }

      // Dependents
      const incoming = graph.getIncoming(contract.id);
      if (incoming.length > 0) {
        lines.push("**Dependents**:");
        for (const rel of incoming) {
          lines.push(`- \`${rel.from}\` ${describeRelationship(rel.type)} this`);
        }
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Generate CLAUDE.md format for AI agents
 * This format is optimized for AI consumption during code editing
 */
export function generateClaudeMd(graph: ContractGraph): string {
  const lines: string[] = [];
  const contracts = graph.getAllContracts();

  lines.push("# Contract Definitions");
  lines.push("");
  lines.push("This section describes the contracts in the system that AI agents should be aware of when making changes.");
  lines.push("");

  // Quick reference table
  lines.push("## Quick Reference");
  lines.push("");
  lines.push("| Contract | Type | Location | Key Invariants |");
  lines.push("|----------|------|----------|----------------|");

  for (const contract of contracts) {
    const location = contract.location ? `\`${contract.location.file}\`` : "-";
    const invariants = contract.invariants
      .filter((i) => i.severity === "error")
      .map((i) => i.description)
      .slice(0, 2)
      .join("; ");
    lines.push(`| ${contract.id} | ${contract.type} | ${location} | ${invariants || "-"} |`);
  }
  lines.push("");

  // Detailed contracts by file
  const byFile = new Map<string, Contract[]>();
  for (const contract of contracts) {
    const file = contract.location?.file || "unlocated";
    const existing = byFile.get(file) || [];
    existing.push(contract);
    byFile.set(file, existing);
  }

  lines.push("## Contracts by File");
  lines.push("");
  lines.push("When editing these files, be aware of the following contracts:");
  lines.push("");

  for (const [file, fileContracts] of byFile) {
    if (file === "unlocated") continue;

    lines.push(`### \`${file}\``);
    lines.push("");

    for (const contract of fileContracts) {
      lines.push(`#### ${contract.id}`);
      lines.push("");

      if (contract.schema) {
        lines.push(`- **Schema**: \`${JSON.stringify(contract.schema)}\``);
      }

      if (contract.invariants.length > 0) {
        lines.push("- **MUST maintain**:");
        for (const inv of contract.invariants) {
          const icon = inv.severity === "error" ? "⛔" : "⚠️";
          lines.push(`  - ${icon} ${inv.description}`);
        }
      }

      if (contract.publishes.length > 0) {
        lines.push(`- **Publishes**: ${contract.publishes.join(", ")}`);
        lines.push("  - ⚠️ Schema changes affect downstream consumers");
      }

      if (contract.consumes.length > 0) {
        lines.push(`- **Consumes**: ${contract.consumes.join(", ")}`);
      }

      if (contract.reads.length > 0 || contract.writes.length > 0) {
        const ops = [
          ...(contract.reads.length > 0 ? [`reads: ${contract.reads.join(", ")}`] : []),
          ...(contract.writes.length > 0 ? [`writes: ${contract.writes.join(", ")}`] : []),
        ];
        lines.push(`- **Database**: ${ops.join("; ")}`);
      }

      if (contract.exposes.length > 0) {
        lines.push("- **Public API**:");
        for (const endpoint of contract.exposes) {
          lines.push(`  - \`${endpoint.method} ${endpoint.path}\``);
        }
      }

      // Cross-repo dependencies
      const incoming = graph.getIncoming(contract.id);
      const crossRepo = incoming.filter((r) => {
        const from = graph.getContract(r.from);
        return from?.repo && from.repo !== contract.repo;
      });

      if (crossRepo.length > 0) {
        lines.push("- **⚠️ Cross-repo dependents**:");
        for (const rel of crossRepo) {
          const from = graph.getContract(rel.from);
          lines.push(`  - ${from?.id} (${from?.repo})`);
        }
      }

      lines.push("");
    }
  }

  // Event contracts (important for distributed systems)
  const events = contracts.filter((c) => c.type === "event" || c.publishes.length > 0 || c.consumes.length > 0);

  if (events.length > 0) {
    lines.push("## Event Contracts");
    lines.push("");
    lines.push("These events connect different parts of the system. Schema changes require coordination.");
    lines.push("");

    const eventMap = new Map<string, { producers: Contract[]; consumers: Contract[] }>();

    for (const contract of contracts) {
      for (const event of contract.publishes) {
        const existing = eventMap.get(event) || { producers: [], consumers: [] };
        existing.producers.push(contract);
        eventMap.set(event, existing);
      }
      for (const event of contract.consumes) {
        const existing = eventMap.get(event) || { producers: [], consumers: [] };
        existing.consumers.push(contract);
        eventMap.set(event, existing);
      }
    }

    for (const [event, { producers, consumers }] of eventMap) {
      lines.push(`### ${event}`);
      lines.push("");
      lines.push(`- **Producers**: ${producers.map((p) => p.id).join(", ") || "none"}`);
      lines.push(`- **Consumers**: ${consumers.map((c) => c.id).join(", ") || "none"}`);

      const repos = new Set([
        ...producers.filter((p) => p.repo).map((p) => p.repo!),
        ...consumers.filter((c) => c.repo).map((c) => c.repo!),
      ]);

      if (repos.size > 1) {
        lines.push(`- **⚠️ Spans repositories**: ${Array.from(repos).join(", ")}`);
      }

      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Group an array by a key function
 */
function groupBy<T>(array: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of array) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}

/**
 * Capitalize a string
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
