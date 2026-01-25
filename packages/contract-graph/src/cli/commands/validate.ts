/**
 * Validate command - Validate contracts and detect breaking changes
 * Designed for CI integration
 */

import type { Command } from "commander";
import pc from "picocolors";
import { loadContracts } from "../loader.js";
import { validateContracts } from "../../validators/contract-validator.js";
import {
  detectBreakingChanges,
  formatBreakingChange,
  type BreakingChange,
} from "../../validators/breaking-changes.js";

export function validateCommand(program: Command): void {
  program
    .command("validate")
    .description("Validate contracts and detect issues (for CI)")
    .option("-d, --dir <path>", "Directory containing contract files", ".")
    .option("--strict", "Fail on warnings as well as errors")
    .option("--check-locations", "Verify that @location file paths exist")
    .option(
      "--base <ref>",
      "Git ref to compare against for breaking change detection",
    )
    .option("--json", "Output as JSON")
    .option("--github-actions", "Output annotations for GitHub Actions")
    .action(async (options) => {
      const { graph, errors: loadErrors } = await loadContracts(options.dir);

      // Validate contracts
      const validationResult = await validateContracts(graph, {
        checkLocations: options.checkLocations,
        baseDir: options.dir,
      });

      // Combine load errors with validation errors
      const allErrors = [
        ...loadErrors.map((e) => ({
          type: "parse" as const,
          message: e.message,
          severity: e.severity,
        })),
        ...validationResult.errors,
      ];

      // Check for breaking changes if base ref provided
      let breakingChanges: BreakingChange[] = [];
      if (options.base) {
        try {
          breakingChanges = await detectBreakingChanges(
            options.dir,
            options.base,
          );
        } catch (err) {
          allErrors.push({
            type: "breaking",
            message: `Failed to detect breaking changes: ${err instanceof Error ? err.message : String(err)}`,
            severity: "warning",
          });
        }
      }

      // Output results
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              valid: validationResult.valid && breakingChanges.length === 0,
              errors: allErrors,
              breakingChanges,
              summary: validationResult.summary,
            },
            null,
            2,
          ),
        );
      } else if (options.githubActions) {
        // GitHub Actions annotation format
        for (const error of allErrors) {
          const level = error.severity === "error" ? "error" : "warning";
          const file =
            "file" in error ? (error as { file?: string }).file : undefined;
          const line =
            "line" in error ? (error as { line?: number }).line : undefined;
          const fileRef = file ? `file=${file}` : "";
          const lineRef = line ? `,line=${line}` : "";
          console.log(`::${level} ${fileRef}${lineRef}::${error.message}`);
        }

        for (const breaking of breakingChanges) {
          console.log(
            `::error ::BREAKING CHANGE: ${formatBreakingChange(breaking)}`,
          );
        }
      } else {
        // Human-readable output
        console.log(pc.bold("Contract Validation Report"));
        console.log(pc.gray("─".repeat(50)));
        console.log();

        // Summary
        console.log(pc.bold("Summary:"));
        console.log(`  Contracts: ${validationResult.summary.totalContracts}`);
        console.log(
          `  Relationships: ${validationResult.summary.totalRelationships}`,
        );
        console.log(
          `  With invariants: ${validationResult.summary.contractsWithInvariants}`,
        );
        console.log();

        // Errors
        const errors = allErrors.filter((e) => e.severity === "error");
        const warnings = allErrors.filter((e) => e.severity === "warning");

        if (errors.length > 0) {
          console.log(pc.bold(pc.red(`Errors (${errors.length}):`)));
          for (const error of errors) {
            const file =
              "file" in error
                ? pc.gray(` [${(error as { file?: string }).file}]`)
                : "";
            console.log(`  ${pc.red("✗")} ${error.message}${file}`);
          }
          console.log();
        }

        if (warnings.length > 0) {
          console.log(pc.bold(pc.yellow(`Warnings (${warnings.length}):`)));
          for (const warning of warnings) {
            console.log(`  ${pc.yellow("⚠")} ${warning.message}`);
          }
          console.log();
        }

        // Breaking changes
        if (breakingChanges.length > 0) {
          console.log(
            pc.bold(pc.red(`Breaking Changes (${breakingChanges.length}):`)),
          );
          for (const breaking of breakingChanges) {
            console.log(`  ${pc.red("⚠")} ${formatBreakingChange(breaking)}`);
          }
          console.log();
        }

        // Final status
        console.log(pc.gray("─".repeat(50)));
        if (errors.length === 0 && breakingChanges.length === 0) {
          if (warnings.length === 0 || !options.strict) {
            console.log(pc.green(pc.bold("✓ Validation passed")));
          } else {
            console.log(
              pc.yellow(
                pc.bold("⚠ Validation passed with warnings (strict mode)"),
              ),
            );
          }
        } else {
          console.log(pc.red(pc.bold("✗ Validation failed")));
        }
      }

      // Exit code
      const hasErrors =
        allErrors.some((e) => e.severity === "error") ||
        breakingChanges.length > 0;
      const hasWarnings = allErrors.some((e) => e.severity === "warning");

      if (hasErrors) {
        process.exit(1);
      }
      if (options.strict && hasWarnings) {
        process.exit(1);
      }
    });
}
