import { beforeEach, describe, expect, it } from "vitest";
import { createContract } from "../../src/graph/contract.js";
import { ContractGraph } from "../../src/graph/graph.js";
import { createRelationship } from "../../src/graph/relationship.js";

describe("ContractGraph", () => {
  let graph: ContractGraph;

  beforeEach(() => {
    graph = new ContractGraph();
  });

  describe("addContract", () => {
    it("adds a contract to the graph", () => {
      const contract = createContract("User.create");
      graph.addContract(contract);
      expect(graph.hasContract("User.create")).toBe(true);
    });

    it("can retrieve added contract", () => {
      const contract = createContract("User.create", { type: "function" });
      graph.addContract(contract);
      const retrieved = graph.getContract("User.create");
      expect(retrieved).toEqual(contract);
    });
  });

  describe("addRelationship", () => {
    it("adds a relationship between contracts", () => {
      graph.addContract(createContract("User.create"));
      graph.addContract(createContract("DB.users"));

      graph.addRelationship(
        createRelationship("User.create", "DB.users", "writes"),
      );

      const outgoing = graph.getOutgoing("User.create");
      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].to).toBe("DB.users");
    });

    it("throws if source contract does not exist", () => {
      graph.addContract(createContract("DB.users"));
      expect(() =>
        graph.addRelationship(
          createRelationship("Unknown", "DB.users", "writes"),
        ),
      ).toThrow("Contract not found: Unknown");
    });

    it("throws if target contract does not exist", () => {
      graph.addContract(createContract("User.create"));
      expect(() =>
        graph.addRelationship(
          createRelationship("User.create", "Unknown", "writes"),
        ),
      ).toThrow("Contract not found: Unknown");
    });
  });

  describe("getIncoming", () => {
    it("returns incoming relationships", () => {
      graph.addContract(createContract("User.create"));
      graph.addContract(createContract("DB.users"));
      graph.addRelationship(
        createRelationship("User.create", "DB.users", "writes"),
      );

      const incoming = graph.getIncoming("DB.users");
      expect(incoming).toHaveLength(1);
      expect(incoming[0].from).toBe("User.create");
    });
  });

  describe("traverse", () => {
    beforeEach(() => {
      // Create a simple graph:
      // A -> B -> C
      //      |
      //      v
      //      D
      graph.addContract(createContract("A"));
      graph.addContract(createContract("B"));
      graph.addContract(createContract("C"));
      graph.addContract(createContract("D"));
      graph.addRelationship(createRelationship("A", "B", "calls"));
      graph.addRelationship(createRelationship("B", "C", "calls"));
      graph.addRelationship(createRelationship("B", "D", "calls"));
    });

    it("traverses outgoing relationships", () => {
      const result = graph.traverse("A", { direction: "outgoing" });
      expect(result.contracts.map((c) => c.id)).toEqual(["A", "B", "C", "D"]);
    });

    it("respects maxDepth", () => {
      const result = graph.traverse("A", {
        direction: "outgoing",
        maxDepth: 1,
      });
      expect(result.contracts.map((c) => c.id)).toEqual(["A", "B"]);
    });

    it("traverses incoming relationships", () => {
      const result = graph.traverse("C", { direction: "incoming" });
      expect(result.contracts.map((c) => c.id)).toEqual(["C", "B", "A"]);
    });

    it("filters by relationship type", () => {
      graph.addRelationship(createRelationship("A", "D", "reads"));
      const result = graph.traverse("A", {
        direction: "outgoing",
        relationshipTypes: ["reads"],
      });
      expect(result.contracts.map((c) => c.id)).toEqual(["A", "D"]);
    });
  });

  describe("findDependents", () => {
    it("finds contracts that depend on the given contract", () => {
      graph.addContract(createContract("DB.users"));
      graph.addContract(createContract("User.create"));
      graph.addContract(createContract("User.update"));
      graph.addRelationship(
        createRelationship("User.create", "DB.users", "writes"),
      );
      graph.addRelationship(
        createRelationship("User.update", "DB.users", "writes"),
      );

      const dependents = graph.findDependents("DB.users");
      expect(dependents.map((c) => c.id).sort()).toEqual([
        "User.create",
        "User.update",
      ]);
    });
  });

  describe("findDependencies", () => {
    it("finds contracts that the given contract depends on", () => {
      graph.addContract(createContract("User.create"));
      graph.addContract(createContract("DB.users"));
      graph.addContract(createContract("Auth.validate"));
      graph.addRelationship(
        createRelationship("User.create", "DB.users", "writes"),
      );
      graph.addRelationship(
        createRelationship("User.create", "Auth.validate", "calls"),
      );

      const deps = graph.findDependencies("User.create");
      expect(deps.map((c) => c.id).sort()).toEqual([
        "Auth.validate",
        "DB.users",
      ]);
    });
  });

  describe("findByFile", () => {
    it("finds contracts by file path", () => {
      graph.addContract(
        createContract("User.create", {
          location: { file: "src/users/create.ts", line: 10 },
        }),
      );
      graph.addContract(
        createContract("User.update", {
          location: { file: "src/users/update.ts", line: 15 },
        }),
      );

      const contracts = graph.findByFile("src/users/create.ts");
      expect(contracts).toHaveLength(1);
      expect(contracts[0].id).toBe("User.create");
    });

    it("matches partial file paths", () => {
      graph.addContract(
        createContract("User.create", {
          location: { file: "src/users/create.ts" },
        }),
      );

      const contracts = graph.findByFile("create.ts");
      expect(contracts).toHaveLength(1);
    });
  });

  describe("findProducers", () => {
    it("finds producers of an event", () => {
      graph.addContract(createContract("Order.place"));
      graph.addContract(createContract("OrderPlaced", { type: "event" }));
      graph.addRelationship(
        createRelationship("Order.place", "OrderPlaced", "publishes"),
      );

      const producers = graph.findProducers("OrderPlaced");
      expect(producers.map((c) => c.id)).toEqual(["Order.place"]);
    });
  });

  describe("findConsumers", () => {
    it("finds consumers of an event", () => {
      graph.addContract(createContract("OrderPlaced", { type: "event" }));
      graph.addContract(createContract("Inventory.reserve"));
      graph.addRelationship(
        createRelationship("Inventory.reserve", "OrderPlaced", "consumes"),
      );

      const consumers = graph.findConsumers("OrderPlaced");
      expect(consumers.map((c) => c.id)).toEqual(["Inventory.reserve"]);
    });
  });

  describe("merge", () => {
    it("merges two graphs", () => {
      graph.addContract(createContract("A"));
      graph.addContract(createContract("B"));
      graph.addRelationship(createRelationship("A", "B", "calls"));

      const other = new ContractGraph();
      other.addContract(createContract("C"));
      other.addContract(createContract("D"));
      other.addRelationship(createRelationship("C", "D", "calls"));

      graph.merge(other);

      expect(graph.getAllContracts()).toHaveLength(4);
      expect(graph.getAllRelationships()).toHaveLength(2);
    });
  });

  describe("getStats", () => {
    it("returns graph statistics", () => {
      graph.addContract(createContract("A", { type: "function" }));
      graph.addContract(createContract("B", { type: "function" }));
      graph.addContract(createContract("C", { type: "table", repo: "repo1" }));
      graph.addRelationship(createRelationship("A", "B", "calls"));
      graph.addRelationship(createRelationship("B", "C", "writes"));

      const stats = graph.getStats();
      expect(stats.contractCount).toBe(3);
      expect(stats.relationshipCount).toBe(2);
      expect(stats.byType.function).toBe(2);
      expect(stats.byType.table).toBe(1);
      expect(stats.byRepo.repo1).toBe(1);
    });
  });
});
