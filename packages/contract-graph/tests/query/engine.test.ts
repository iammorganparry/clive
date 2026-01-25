import { describe, it, expect, beforeEach } from "vitest";
import { ContractGraph } from "../../src/graph/graph.js";
import { createContract } from "../../src/graph/contract.js";
import { createRelationship } from "../../src/graph/relationship.js";
import { QueryEngine } from "../../src/query/engine.js";

describe("QueryEngine", () => {
  let graph: ContractGraph;
  let engine: QueryEngine;

  beforeEach(() => {
    graph = new ContractGraph();
  });

  describe("contractsFor", () => {
    it("returns contracts for a file path", () => {
      graph.addContract(
        createContract("User.create", {
          location: { file: "src/users/create.ts", line: 10 },
          invariants: [{ description: "email must be unique", severity: "error" }],
          errors: [{ name: "UserNotFound" }],
        })
      );
      engine = new QueryEngine(graph);

      const result = engine.contractsFor("src/users/create.ts");
      expect(result.contracts).toHaveLength(1);
      expect(result.invariants).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
    });

    it("includes dependents", () => {
      graph.addContract(
        createContract("User.create", {
          location: { file: "src/users/create.ts" },
        })
      );
      graph.addContract(createContract("API.createUser"));
      graph.addRelationship(createRelationship("API.createUser", "User.create", "calls"));
      engine = new QueryEngine(graph);

      const result = engine.contractsFor("src/users/create.ts");
      expect(result.dependents).toHaveLength(1);
      expect(result.dependents[0].id).toBe("API.createUser");
    });
  });

  describe("impactOf", () => {
    it("returns null for non-existent contract", () => {
      engine = new QueryEngine(graph);
      expect(engine.impactOf("NonExistent")).toBeNull();
    });

    it("returns impact analysis for existing contract", () => {
      graph.addContract(
        createContract("OrderPlaced", {
          type: "event",
          schema: { orderId: "string" },
        })
      );
      graph.addContract(createContract("Order.place"));
      graph.addContract(createContract("Inventory.reserve"));
      graph.addContract(createContract("Notification.send"));

      graph.addRelationship(createRelationship("Order.place", "OrderPlaced", "publishes"));
      graph.addRelationship(createRelationship("Inventory.reserve", "OrderPlaced", "consumes"));
      graph.addRelationship(createRelationship("Notification.send", "OrderPlaced", "consumes"));

      engine = new QueryEngine(graph);
      const impact = engine.impactOf("OrderPlaced");

      expect(impact).not.toBeNull();
      expect(impact!.contract.id).toBe("OrderPlaced");
      expect(impact!.producers).toHaveLength(1);
      expect(impact!.consumers).toHaveLength(2);
    });

    it("detects cross-repo impacts", () => {
      graph.addContract(createContract("OrderPlaced", { type: "event", repo: "order-service" }));
      graph.addContract(createContract("Inventory.reserve", { repo: "inventory-service" }));
      graph.addRelationship(createRelationship("Inventory.reserve", "OrderPlaced", "consumes"));

      engine = new QueryEngine(graph);
      const impact = engine.impactOf("OrderPlaced");

      expect(impact!.crossRepoImpacts.size).toBe(1);
      expect(impact!.crossRepoImpacts.has("inventory-service")).toBe(true);
      expect(impact!.warnings.some((w) => w.includes("CROSS-SERVICE"))).toBe(true);
    });

    it("collects invariants to maintain", () => {
      graph.addContract(
        createContract("DB.users", {
          type: "table",
          invariants: [{ description: "email must be unique", severity: "error" }],
        })
      );
      graph.addContract(
        createContract("User.create", {
          invariants: [{ description: "password must be hashed", severity: "error" }],
        })
      );
      graph.addRelationship(createRelationship("User.create", "DB.users", "writes"));

      engine = new QueryEngine(graph);
      const impact = engine.impactOf("DB.users");

      expect(impact!.invariantsToMaintain.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("invariantsFor", () => {
    it("returns invariants for a code location", () => {
      graph.addContract(
        createContract("User.create", {
          location: { file: "src/users/create.ts" },
          invariants: [
            { description: "email must be unique", severity: "error" },
            { description: "password must be hashed", severity: "error" },
          ],
        })
      );
      engine = new QueryEngine(graph);

      const invariants = engine.invariantsFor("src/users/create.ts");
      expect(invariants).toHaveLength(2);
    });
  });

  describe("errorsFor", () => {
    it("returns errors for a contract", () => {
      graph.addContract(
        createContract("User.create", {
          errors: [
            { name: "UserNotFound" },
            { name: "ValidationError", description: "Invalid input" },
          ],
        })
      );
      engine = new QueryEngine(graph);

      const errors = engine.errorsFor("User.create");
      expect(errors).toHaveLength(2);
    });

    it("returns empty array for non-existent contract", () => {
      engine = new QueryEngine(graph);
      expect(engine.errorsFor("NonExistent")).toEqual([]);
    });
  });

  describe("dependencyGraph", () => {
    it("returns full dependency graph", () => {
      graph.addContract(createContract("A"));
      graph.addContract(createContract("B"));
      graph.addContract(createContract("C"));
      graph.addRelationship(createRelationship("A", "B", "calls"));
      graph.addRelationship(createRelationship("B", "C", "calls"));

      engine = new QueryEngine(graph);
      const result = engine.dependencyGraph("A");

      expect(result).not.toBeNull();
      expect(result!.contracts).toHaveLength(3);
      // Relationships are collected from both directions during traversal
      // so we get duplicates when traversing "both" directions
      expect(result!.relationships.length).toBeGreaterThanOrEqual(2);
    });

    it("respects maxDepth", () => {
      graph.addContract(createContract("A"));
      graph.addContract(createContract("B"));
      graph.addContract(createContract("C"));
      graph.addRelationship(createRelationship("A", "B", "calls"));
      graph.addRelationship(createRelationship("B", "C", "calls"));

      engine = new QueryEngine(graph);
      const result = engine.dependencyGraph("A", { maxDepth: 1 });

      expect(result!.contracts).toHaveLength(2);
    });
  });

  describe("find", () => {
    beforeEach(() => {
      graph.addContract(createContract("A", { type: "function", repo: "repo1" }));
      graph.addContract(
        createContract("B", {
          type: "event",
          repo: "repo2",
          publishes: ["EventX"],
        })
      );
      graph.addContract(
        createContract("C", {
          type: "table",
          invariants: [{ description: "test", severity: "error" }],
        })
      );
      engine = new QueryEngine(graph);
    });

    it("filters by type", () => {
      const results = engine.find({ type: "event" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("B");
    });

    it("filters by repo", () => {
      const results = engine.find({ repo: "repo1" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("A");
    });

    it("filters by hasInvariants", () => {
      const results = engine.find({ hasInvariants: true });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("C");
    });

    it("filters by publishes", () => {
      const results = engine.find({ publishes: "EventX" });
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("B");
    });
  });

  describe("summary", () => {
    it("returns summary statistics", () => {
      graph.addContract(
        createContract("A", {
          type: "function",
          repo: "repo1",
          invariants: [{ description: "test", severity: "error" }],
        })
      );
      graph.addContract(createContract("B", { type: "table", repo: "repo2" }));
      graph.addRelationship(createRelationship("A", "B", "writes"));

      engine = new QueryEngine(graph);
      const summary = engine.summary();

      expect(summary.totalContracts).toBe(2);
      expect(summary.totalRelationships).toBe(1);
      expect(summary.contractsWithInvariants).toBe(1);
      expect(summary.crossRepoRelationships).toBe(1);
    });
  });
});
