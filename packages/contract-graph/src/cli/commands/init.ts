/**
 * Init command - Initialize contract-graph in a project
 */

import type { Command } from "commander";
import pc from "picocolors";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXAMPLE_CONTRACT = `\`\`\`mermaid
graph TB
    %% @contract Example.createUser
    %% @location src/services/user.ts:15
    %% @schema {"input": "CreateUserDTO", "output": "User"}
    %% @invariant email must be unique
    %% @error UserAlreadyExists, ValidationError
    createUser[createUser]

    %% @contract DB.users
    %% @location src/db/schema.ts:10
    %% @schema {"table": "users", "pk": "id"}
    users[(users)]

    createUser -->|"writes"| users
\`\`\`

## How to define contracts

Contracts are defined using Mermaid diagrams with embedded metadata in comments.

### Core Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| \`@contract\` | Names the contract | \`@contract UserService.createUser\` |
| \`@location\` | Maps to code | \`@location src/services/user.ts:23\` |
| \`@schema\` | Input/output types | \`@schema {"input": "UserInput", "output": "User"}\` |
| \`@invariant\` | Business rules | \`@invariant email must be unique\` |
| \`@error\` | Error contracts | \`@error UserNotFound, ValidationError\` |
| \`@version\` | Contract version | \`@version 1.2.0\` |

### Distributed System Annotations

| Annotation | Purpose | Example |
|------------|---------|---------|
| \`@publishes\` | Event/message published | \`@publishes OrderPlaced\` |
| \`@consumes\` | Event/message consumed | \`@consumes OrderPlaced\` |
| \`@exposes\` | HTTP/gRPC API endpoint | \`@exposes POST /api/users\` |
| \`@calls\` | External API dependency | \`@calls PaymentGateway.charge\` |
| \`@reads\` | Database/table read | \`@reads orders, users\` |
| \`@writes\` | Database/table write | \`@writes orders\` |
| \`@queue\` | Message queue | \`@queue order-events\` |
| \`@repo\` | Repository/service | \`@repo github.com/org/service\` |

## CLI Commands

\`\`\`bash
# Query contracts for a file
contract-graph query --file src/services/user.ts

# Analyze impact of changing a contract
contract-graph impact UserService.createUser

# Validate contracts (for CI)
contract-graph validate

# Generate documentation
contract-graph docs --output docs/contracts.md
\`\`\`
`;

const GITIGNORE_ADDITIONS = `
# Contract Graph
.contract-graph/cache/
`;

export function initCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize contract-graph in the current project")
    .option("-d, --dir <path>", "Directory to initialize", ".")
    .option("-f, --force", "Overwrite existing files")
    .action(async (options) => {
      const baseDir = options.dir;
      const contractsDir = join(baseDir, "contracts");
      const contractsFile = join(contractsDir, "README.md");

      // Create contracts directory
      if (!existsSync(contractsDir)) {
        await mkdir(contractsDir, { recursive: true });
        console.log(pc.green("✓ Created contracts/ directory"));
      }

      // Create example contract file
      if (!existsSync(contractsFile) || options.force) {
        await writeFile(
          contractsFile,
          `# System Contracts\n\nThis directory contains contract definitions for the system.\n\n## Example Contract\n\n${EXAMPLE_CONTRACT}`,
          "utf-8",
        );
        console.log(pc.green("✓ Created contracts/README.md with example"));
      } else {
        console.log(
          pc.yellow(
            "⚠ contracts/README.md already exists, use --force to overwrite",
          ),
        );
      }

      // Add to .gitignore
      const gitignorePath = join(baseDir, ".gitignore");
      if (existsSync(gitignorePath)) {
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(gitignorePath, "utf-8");
        if (!content.includes(".contract-graph/cache/")) {
          await writeFile(
            gitignorePath,
            content + GITIGNORE_ADDITIONS,
            "utf-8",
          );
          console.log(pc.green("✓ Updated .gitignore"));
        }
      }

      console.log();
      console.log(pc.bold("Contract Graph initialized!"));
      console.log();
      console.log("Next steps:");
      console.log(
        "  1. Define your contracts in contracts/*.md using Mermaid diagrams",
      );
      console.log("  2. Run 'contract-graph validate' to check your contracts");
      console.log("  3. Run 'contract-graph docs' to generate documentation");
      console.log();
      console.log(
        "For more information, see: https://github.com/your-org/contract-graph",
      );
    });
}
