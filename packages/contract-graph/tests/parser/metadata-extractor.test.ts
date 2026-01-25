import { describe, expect, it } from "vitest";
import {
  extractAnnotations,
  extractNodeId,
  groupCommentBlocks,
  parseEndpointExposure,
  parseErrors,
  parseInvariants,
  parseSchema,
} from "../../src/parser/metadata-extractor.js";

describe("extractAnnotations", () => {
  it("extracts contract annotation", () => {
    const lines = ["%% @contract UserService.createUser"];
    const result = extractAnnotations(lines);
    expect(result.contract).toBe("UserService.createUser");
  });

  it("extracts location annotation", () => {
    const lines = ["%% @location src/services/user.ts:23"];
    const result = extractAnnotations(lines);
    expect(result.location).toBe("src/services/user.ts:23");
  });

  it("extracts schema annotation", () => {
    const lines = ['%% @schema {"input": "UserInput", "output": "User"}'];
    const result = extractAnnotations(lines);
    expect(result.schema).toBe('{"input": "UserInput", "output": "User"}');
  });

  it("extracts multiple invariants", () => {
    const lines = [
      "%% @invariant email must be unique",
      "%% @invariant password must be hashed",
    ];
    const result = extractAnnotations(lines);
    expect(result.invariants).toHaveLength(2);
    expect(result.invariants[0]).toBe("email must be unique");
    expect(result.invariants[1]).toBe("password must be hashed");
  });

  it("extracts comma-separated errors", () => {
    const lines = ["%% @error UserNotFound, ValidationError"];
    const result = extractAnnotations(lines);
    expect(result.errors).toEqual(["UserNotFound", "ValidationError"]);
  });

  it("extracts distributed system annotations", () => {
    const lines = [
      "%% @publishes OrderPlaced",
      "%% @consumes PaymentReceived",
      "%% @exposes POST /api/orders",
      "%% @calls PaymentGateway.charge",
      "%% @reads orders, users",
      "%% @writes orders",
      "%% @queue order-events",
      "%% @repo github.com/org/order-service",
    ];
    const result = extractAnnotations(lines);
    expect(result.publishes).toEqual(["OrderPlaced"]);
    expect(result.consumes).toEqual(["PaymentReceived"]);
    expect(result.exposes).toEqual(["POST /api/orders"]);
    expect(result.calls).toEqual(["PaymentGateway.charge"]);
    expect(result.reads).toEqual(["orders", "users"]);
    expect(result.writes).toEqual(["orders"]);
    expect(result.queue).toBe("order-events");
    expect(result.repo).toBe("github.com/org/order-service");
  });

  it("handles multiple annotations in one block", () => {
    const lines = [
      "%% @contract Order.place",
      "%% @location src/orders/place.ts:15",
      '%% @schema {"input": "PlaceOrderDTO"}',
      "%% @invariant cannot order out of stock items",
      "%% @publishes OrderPlaced",
    ];
    const result = extractAnnotations(lines);
    expect(result.contract).toBe("Order.place");
    expect(result.location).toBe("src/orders/place.ts:15");
    expect(result.invariants).toHaveLength(1);
    expect(result.publishes).toEqual(["OrderPlaced"]);
  });
});

describe("parseSchema", () => {
  it("parses JSON schema", () => {
    const schema = parseSchema('{"input": "UserInput", "output": "User"}');
    expect(schema).toEqual({ input: "UserInput", output: "User" });
  });

  it("handles simple type reference", () => {
    const schema = parseSchema("User");
    expect(schema).toEqual({ output: "User" });
  });

  it("returns undefined for empty string", () => {
    const schema = parseSchema("");
    expect(schema).toBeUndefined();
  });
});

describe("parseEndpointExposure", () => {
  it("parses POST endpoint", () => {
    const endpoint = parseEndpointExposure("POST /api/users");
    expect(endpoint).toEqual({ method: "POST", path: "/api/users" });
  });

  it("parses GET endpoint", () => {
    const endpoint = parseEndpointExposure("GET /api/users/:id");
    expect(endpoint).toEqual({ method: "GET", path: "/api/users/:id" });
  });

  it("returns undefined for invalid format", () => {
    const endpoint = parseEndpointExposure("/api/users");
    expect(endpoint).toBeUndefined();
  });

  it("handles lowercase methods", () => {
    const endpoint = parseEndpointExposure("post /api/users");
    expect(endpoint).toEqual({ method: "POST", path: "/api/users" });
  });
});

describe("parseInvariants", () => {
  it("parses invariant with default error severity", () => {
    const invariants = parseInvariants(["email must be unique"]);
    expect(invariants).toEqual([
      { description: "email must be unique", severity: "error" },
    ]);
  });

  it("parses invariant with explicit severity", () => {
    const invariants = parseInvariants([
      "[error] email must be unique",
      "[warning] password should be strong",
      "[info] consider adding MFA",
    ]);
    expect(invariants).toEqual([
      { description: "email must be unique", severity: "error" },
      { description: "password should be strong", severity: "warning" },
      { description: "consider adding MFA", severity: "info" },
    ]);
  });
});

describe("parseErrors", () => {
  it("parses simple error names", () => {
    const errors = parseErrors(["UserNotFound", "ValidationError"]);
    expect(errors).toEqual([
      { name: "UserNotFound" },
      { name: "ValidationError" },
    ]);
  });

  it("parses errors with descriptions", () => {
    const errors = parseErrors([
      "UserNotFound: The specified user does not exist",
    ]);
    expect(errors).toEqual([
      {
        name: "UserNotFound",
        description: "The specified user does not exist",
      },
    ]);
  });
});

describe("groupCommentBlocks", () => {
  it("groups consecutive comments before a node", () => {
    const lines = [
      "graph TB",
      "    %% @contract User.create",
      "    %% @location src/user.ts:10",
      "    createUser[createUser]",
      "",
      "    %% @contract DB.users",
      "    users[(users)]",
    ];
    const blocks = groupCommentBlocks(lines);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].comments).toHaveLength(2);
    expect(blocks[0].nodeLineIndex).toBe(3);
    expect(blocks[1].comments).toHaveLength(1);
    expect(blocks[1].nodeLineIndex).toBe(6);
  });
});

describe("extractNodeId", () => {
  it("extracts ID from rectangle node", () => {
    expect(extractNodeId("createUser[createUser]")).toBe("createUser");
  });

  it("extracts ID from cylinder node", () => {
    expect(extractNodeId("users[(users)]")).toBe("users");
  });

  it("extracts ID from rounded node", () => {
    expect(extractNodeId("service(Service)")).toBe("service");
  });

  it("extracts ID from hexagon node", () => {
    expect(extractNodeId("event{{OrderPlaced}}")).toBe("event");
  });

  it("extracts ID from bare node", () => {
    expect(extractNodeId("simpleNode")).toBe("simpleNode");
  });
});
