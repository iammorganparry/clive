#!/usr/bin/env node
import { execSync } from "node:child_process";
/**
 * Sets a dev version in package.json based on timestamp
 * This ensures each local install is treated as a new version
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packagePath = join(__dirname, "..", "package.json");

const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
const baseVersion = pkg.version.split("-")[0]; // Strip any existing dev suffix

// Get short git hash for traceability
let gitHash = "local";
try {
  gitHash = execSync("git rev-parse --short HEAD", {
    encoding: "utf-8",
  }).trim();
} catch {
  // Ignore if not in a git repo
}

// Create dev version: 0.0.1-dev.abc1234.1735489200
const timestamp = Math.floor(Date.now() / 1000);
pkg.version = `${baseVersion}-dev.${gitHash}.${timestamp}`;

writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`Set version to ${pkg.version}`);
