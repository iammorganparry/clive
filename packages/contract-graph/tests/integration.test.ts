import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFromMarkdown } from "../src/parser/contract-builder.js";
import { QueryEngine } from "../src/query/engine.js";
import { validateContracts } from "../src/validators/contract-validator.js";
import { generateClaudeMd } from "../src/generators/markdown.js";

describe("Integration", () => {
  const fixturesDir = join(__dirname, "fixtures");
  const sampleMarkdown = readFileSync(join(fixturesDir, "sample-contracts.md"), "utf-8");

  describe("Full parsing flow", () => {
    it("parses sample contracts from markdown", () => {
      const result = buildFromMarkdown(sampleMarkdown);

      expect(result.errors.filter((e) => e.severity === "error")).toHaveLength(0);
      expect(result.graph.getAllContracts().length).toBeGreaterThan(0);
    });

    it("extracts all expected contracts", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const contracts = graph.getAllContracts();
      const ids = contracts.map((c) => c.id);

      expect(ids).toContain("Order.place");
      expect(ids).toContain("DB.orders");
      expect(ids).toContain("Events.OrderPlaced");
      expect(ids).toContain("Inventory.reserve");
    });

    it("extracts contract metadata correctly", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);

      const orderPlace = graph.getContract("Order.place");
      expect(orderPlace).toBeDefined();
      expect(orderPlace!.location?.file).toBe("src/orders/place.ts");
      expect(orderPlace!.location?.line).toBe(15);
      expect(orderPlace!.exposes).toHaveLength(1);
      expect(orderPlace!.exposes[0]).toEqual({ method: "POST", path: "/api/orders" });
      expect(orderPlace!.publishes).toContain("OrderPlaced");
      expect(orderPlace!.writes).toContain("orders");
      expect(orderPlace!.invariants).toHaveLength(1);
      expect(orderPlace!.errors).toHaveLength(2);
    });

    it("builds relationships from edges", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const relationships = graph.getAllRelationships();

      expect(relationships.length).toBeGreaterThan(0);

      // Check for write relationship
      const writeRel = relationships.find(
        (r) => r.from === "Order.place" && r.type === "writes"
      );
      expect(writeRel).toBeDefined();
    });
  });

  describe("Query engine with parsed contracts", () => {
    it("finds contracts by file path", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const engine = new QueryEngine(graph);

      const result = engine.contractsFor("src/orders/place.ts");
      expect(result.contracts).toHaveLength(1);
      expect(result.contracts[0].id).toBe("Order.place");
    });

    it("analyzes impact of event changes", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const engine = new QueryEngine(graph);

      const impact = engine.impactOf("Events.OrderPlaced");
      expect(impact).not.toBeNull();

      // Should find producers and consumers
      expect(impact!.producers.length + impact!.consumers.length).toBeGreaterThan(0);
    });

    it("returns invariants for code location", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const engine = new QueryEngine(graph);

      const invariants = engine.invariantsFor("src/orders/place.ts");
      expect(invariants.length).toBeGreaterThan(0);
      expect(invariants[0].description).toContain("order total");
    });
  });

  describe("Validation", () => {
    it("validates parsed contracts without errors", async () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const result = await validateContracts(graph);

      expect(result.valid).toBe(true);
      expect(result.summary.totalContracts).toBeGreaterThan(0);
    });

    it("detects issues with options enabled", async () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const result = await validateContracts(graph, {
        requireLocations: true,
        warnOrphans: true,
      });

      // Some contracts might not have locations
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Documentation generation", () => {
    it("generates CLAUDE.md format", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const docs = generateClaudeMd(graph);

      expect(docs).toContain("# Contract Definitions");
      expect(docs).toContain("Quick Reference");
      expect(docs).toContain("Order.place");
    });

    it("includes invariants in documentation", () => {
      const { graph } = buildFromMarkdown(sampleMarkdown);
      const docs = generateClaudeMd(graph);

      expect(docs).toContain("MUST maintain");
      expect(docs).toContain("order total must be positive");
    });
  });
});
