import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AnnotationResult,
  annotateSourceFiles,
  formatAnnotationResults,
  injectAnnotation,
} from "../../src/generators/code-annotator.js";
import { createContract } from "../../src/graph/contract.js";
import { ContractGraph } from "../../src/graph/graph.js";

describe("code-annotator", () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "code-annotator-test-"));
  });

  afterEach(() => {
    // Clean up temporary directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a test file
   */
  function createTestFile(filename: string, content: string): string {
    const filePath = path.join(tempDir, filename);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content);
    return filePath;
  }

  /**
   * Helper to read a test file
   */
  function readTestFile(filename: string): string {
    return fs.readFileSync(path.join(tempDir, filename), "utf-8");
  }

  describe("injectAnnotation", () => {
    describe("functions without existing JSDoc", () => {
      it("adds minimal JSDoc block with @contract and @see", () => {
        const content = `function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          1,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`/**
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("preserves indentation for indented functions", () => {
        const content = `class UserService {
  createUser(data) {
    return db.insert(data);
  }
}`;
        const result = injectAnnotation(
          content,
          2,
          "UserService.create",
          "contracts/system.md",
        );

        expect(result).toBe(`class UserService {
  /**
   * @contract UserService.create
   * @see contracts/system.md#UserService.create
   */
  createUser(data) {
    return db.insert(data);
  }
}`);
      });

      it("handles arrow function assignments", () => {
        const content = `const createUser = (data) => {
  return db.insert(data);
};`;
        const result = injectAnnotation(
          content,
          1,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`/**
 * @contract User.create
 * @see contracts/system.md#User.create
 */
const createUser = (data) => {
  return db.insert(data);
};`);
      });

      it("handles tRPC procedure declarations", () => {
        const content = `export const userRouter = {
  create: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.insert(users).values(input);
    }),
};`;
        const result = injectAnnotation(
          content,
          2,
          "user.create",
          "contracts/system.md",
        );

        expect(result).toBe(`export const userRouter = {
  /**
   * @contract user.create
   * @see contracts/system.md#user.create
   */
  create: protectedProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.insert(users).values(input);
    }),
};`);
      });
    });

    describe("functions with existing JSDoc", () => {
      it("merges @contract into existing JSDoc with description", () => {
        const content = `/**
 * Create a new user in the database
 */
function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          4,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`/**
 * Create a new user in the database
 *
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("merges into JSDoc with existing tags", () => {
        const content = `/**
 * Create a new user
 *
 * @param data - The user data
 * @returns The created user
 */
function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          7,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`/**
 * Create a new user
 *
 * @param data - The user data
 * @returns The created user
 *
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("skips when @contract already exists with same value", () => {
        const content = `/**
 * Create a user
 *
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`;
        // The result should be unchanged
        const result = injectAnnotation(
          content,
          7,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(content);
      });

      it("updates @contract when value differs", () => {
        const content = `/**
 * Create a user
 *
 * @contract User.oldCreate
 * @see contracts/old.md#User.oldCreate
 */
function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          7,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`/**
 * Create a user
 *
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("handles single-line JSDoc", () => {
        const content = `/** Create a user */
function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          2,
          "User.create",
          "contracts/system.md",
        );

        // Single-line JSDoc should be expanded to multi-line with contract tags
        expect(result).toBe(`/**
 * Create a user
 *
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });
    });

    describe("edge cases", () => {
      it("handles empty file", () => {
        const content = "";
        const result = injectAnnotation(
          content,
          1,
          "Test",
          "contracts/system.md",
        );
        // Empty file should be skipped
        expect(result).toBe(content);
      });

      it("handles whitespace-only file", () => {
        const content = "   \n\n   ";
        const result = injectAnnotation(
          content,
          1,
          "Test",
          "contracts/system.md",
        );
        // Whitespace-only file should be skipped
        expect(result).toBe(content);
      });

      it("handles line number out of bounds (too high)", () => {
        const content = `function test() {}`;
        const result = injectAnnotation(
          content,
          100,
          "Test",
          "contracts/system.md",
        );
        expect(result).toBe(content);
      });

      it("handles line number out of bounds (zero)", () => {
        const content = `function test() {}`;
        const result = injectAnnotation(
          content,
          0,
          "Test",
          "contracts/system.md",
        );
        expect(result).toBe(content);
      });

      it("handles line number out of bounds (negative)", () => {
        const content = `function test() {}`;
        const result = injectAnnotation(
          content,
          -1,
          "Test",
          "contracts/system.md",
        );
        expect(result).toBe(content);
      });

      it("handles decorators above function", () => {
        const content = `@Injectable()
export class UserService {
  createUser(data) {
    return db.insert(data);
  }
}`;
        // Targeting the method, not the decorator
        const result = injectAnnotation(
          content,
          3,
          "UserService.create",
          "contracts/system.md",
        );

        expect(result).toBe(`@Injectable()
export class UserService {
  /**
   * @contract UserService.create
   * @see contracts/system.md#UserService.create
   */
  createUser(data) {
    return db.insert(data);
  }
}`);
      });

      it("handles multiple blank lines before target", () => {
        const content = `

function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          3,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`

/**
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("does not confuse regular comments with JSDoc", () => {
        const content = `// This is a regular comment
/* This is a block comment */
function createUser(data) {
  return db.insert(data);
}`;
        const result = injectAnnotation(
          content,
          3,
          "User.create",
          "contracts/system.md",
        );

        expect(result).toBe(`// This is a regular comment
/* This is a block comment */
/**
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser(data) {
  return db.insert(data);
}`);
      });

      it("handles tab indentation", () => {
        const content = `class UserService {
\tcreateUser(data) {
\t\treturn db.insert(data);
\t}
}`;
        const result = injectAnnotation(
          content,
          2,
          "UserService.create",
          "contracts/system.md",
        );

        expect(result).toBe(`class UserService {
\t/**
\t * @contract UserService.create
\t * @see contracts/system.md#UserService.create
\t */
\tcreateUser(data) {
\t\treturn db.insert(data);
\t}
}`);
      });
    });
  });

  describe("annotateSourceFiles", () => {
    describe("basic functionality", () => {
      it("annotates multiple contracts in a single file", async () => {
        const filename = "services/user.ts";
        createTestFile(
          filename,
          `function createUser(data) {
  return db.insert(data);
}

function getUser(id) {
  return db.select(id);
}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: filename, line: 1 },
          }),
        );
        graph.addContract(
          createContract("User.get", {
            location: { file: filename, line: 5 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
          dryRun: false,
        });

        expect(results).toHaveLength(2);
        expect(results.every((r) => r.action === "added")).toBe(true);

        const content = readTestFile(filename);
        expect(content).toContain("@contract User.create");
        expect(content).toContain("@contract User.get");
      });

      it("annotates contracts across multiple files", async () => {
        createTestFile(
          "services/user.ts",
          `function createUser(data) {
  return db.insert(data);
}`,
        );
        createTestFile(
          "services/order.ts",
          `function createOrder(data) {
  return db.insert(data);
}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "services/user.ts", line: 1 },
          }),
        );
        graph.addContract(
          createContract("Order.create", {
            location: { file: "services/order.ts", line: 1 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
          dryRun: false,
        });

        expect(results).toHaveLength(2);

        expect(readTestFile("services/user.ts")).toContain(
          "@contract User.create",
        );
        expect(readTestFile("services/order.ts")).toContain(
          "@contract Order.create",
        );
      });

      it("processes contracts in descending line order to preserve offsets", async () => {
        const filename = "services/user.ts";
        createTestFile(
          filename,
          `function first() {}
function second() {}
function third() {}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("First", {
            location: { file: filename, line: 1 },
          }),
        );
        graph.addContract(
          createContract("Second", {
            location: { file: filename, line: 2 },
          }),
        );
        graph.addContract(
          createContract("Third", {
            location: { file: filename, line: 3 },
          }),
        );

        await annotateSourceFiles(graph, {
          baseDir: tempDir,
          dryRun: false,
        });

        const content = readTestFile(filename);
        // All three should be annotated correctly
        expect(content).toContain("@contract First");
        expect(content).toContain("@contract Second");
        expect(content).toContain("@contract Third");

        // Verify order is preserved
        const firstIndex = content.indexOf("@contract First");
        const secondIndex = content.indexOf("@contract Second");
        const thirdIndex = content.indexOf("@contract Third");
        expect(firstIndex).toBeLessThan(secondIndex);
        expect(secondIndex).toBeLessThan(thirdIndex);
      });
    });

    describe("dry run mode", () => {
      it("does not write files when dryRun is true", async () => {
        const filename = "services/user.ts";
        const originalContent = `function createUser(data) {
  return db.insert(data);
}`;
        createTestFile(filename, originalContent);

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: filename, line: 1 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
          dryRun: true,
        });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("added");

        // File should be unchanged
        expect(readTestFile(filename)).toBe(originalContent);
      });

      it("returns correct results even in dry run mode", async () => {
        const filename = "services/user.ts";
        createTestFile(
          filename,
          `/**
 * @contract User.create
 */
function createUser(data) {}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: filename, line: 4 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
          dryRun: true,
        });

        expect(results[0].action).toBe("skipped");
        expect(results[0].reason).toContain("Already annotated");
      });
    });

    describe("skip scenarios", () => {
      it("skips contracts without location", async () => {
        createTestFile("services/user.ts", `function createUser(data) {}`);

        const graph = new ContractGraph();
        graph.addContract(createContract("User.create")); // No location

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(0);
      });

      it("skips contracts without line number", async () => {
        createTestFile("services/user.ts", `function createUser(data) {}`);

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "services/user.ts" }, // No line number
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(0);
      });

      it("skips when file does not exist", async () => {
        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "nonexistent/file.ts", line: 1 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("skipped");
        expect(results[0].reason).toBe("File not found");
      });

      it("skips when line number is out of bounds", async () => {
        createTestFile("services/user.ts", `function createUser() {}`);

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "services/user.ts", line: 100 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("skipped");
        expect(results[0].reason).toContain("out of bounds");
      });

      it("skips when @contract already exists with same value", async () => {
        createTestFile(
          "services/user.ts",
          `/**
 * @contract User.create
 * @see contracts/system.md#User.create
 */
function createUser() {}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "services/user.ts", line: 5 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("skipped");
        expect(results[0].reason).toContain("Already annotated");
      });
    });

    describe("custom contracts file path", () => {
      it("uses custom contractsFile in @see links", async () => {
        createTestFile("services/user.ts", `function createUser() {}`);

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: "services/user.ts", line: 1 },
          }),
        );

        await annotateSourceFiles(graph, {
          baseDir: tempDir,
          contractsFile: "docs/contracts.md",
        });

        const content = readTestFile("services/user.ts");
        expect(content).toContain("@see docs/contracts.md#User.create");
      });
    });

    describe("absolute paths", () => {
      it("handles absolute file paths in contracts", async () => {
        const absolutePath = createTestFile(
          "services/user.ts",
          `function createUser() {}`,
        );

        const graph = new ContractGraph();
        graph.addContract(
          createContract("User.create", {
            location: { file: absolutePath, line: 1 },
          }),
        );

        const results = await annotateSourceFiles(graph, {
          baseDir: tempDir,
        });

        expect(results).toHaveLength(1);
        expect(results[0].action).toBe("added");
      });
    });
  });

  describe("formatAnnotationResults", () => {
    it("formats results with counts by action", () => {
      const results: AnnotationResult[] = [
        { file: "a.ts", contractId: "A", line: 1, action: "added" },
        { file: "b.ts", contractId: "B", line: 2, action: "added" },
        { file: "c.ts", contractId: "C", line: 3, action: "updated" },
        {
          file: "d.ts",
          contractId: "D",
          line: 4,
          action: "skipped",
          reason: "Already annotated",
        },
      ];

      const formatted = formatAnnotationResults(results);

      expect(formatted).toContain("a.ts:1 - A (added)");
      expect(formatted).toContain("b.ts:2 - B (added)");
      expect(formatted).toContain("c.ts:3 - C (updated)");
      expect(formatted).toContain("d.ts:4 - D (skipped - Already annotated)");
      expect(formatted).toContain("Summary: 2 added, 1 updated, 1 skipped");
    });

    it("handles empty results", () => {
      const formatted = formatAnnotationResults([]);

      expect(formatted).toContain("Code annotations injected:");
      expect(formatted).toContain("Summary: 0 added, 0 updated, 0 skipped");
    });

    it("groups results by action type", () => {
      const results: AnnotationResult[] = [
        {
          file: "a.ts",
          contractId: "A",
          line: 1,
          action: "skipped",
          reason: "File not found",
        },
        { file: "b.ts", contractId: "B", line: 2, action: "added" },
        { file: "c.ts", contractId: "C", line: 3, action: "added" },
      ];

      const formatted = formatAnnotationResults(results);
      const lines = formatted.split("\n");

      // Added should come before skipped in output
      const addedIndex = lines.findIndex((l) => l.includes("(added)"));
      const skippedIndex = lines.findIndex((l) => l.includes("(skipped"));
      expect(addedIndex).toBeLessThan(skippedIndex);
    });
  });

  describe("real-world patterns", () => {
    it("handles Express.js route handler", async () => {
      createTestFile(
        "routes/users.ts",
        `import { Router } from 'express';

const router = Router();

router.post('/users', async (req, res) => {
  const user = await createUser(req.body);
  res.json(user);
});

export default router;`,
      );

      const graph = new ContractGraph();
      graph.addContract(
        createContract("API.createUser", {
          location: { file: "routes/users.ts", line: 5 },
        }),
      );

      await annotateSourceFiles(graph, { baseDir: tempDir });

      const content = readTestFile("routes/users.ts");
      expect(content).toContain("@contract API.createUser");
    });

    it("handles NestJS controller method", async () => {
      createTestFile(
        "controllers/users.controller.ts",
        `import { Controller, Post, Body } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }
}`,
      );

      const graph = new ContractGraph();
      graph.addContract(
        createContract("UsersController.create", {
          location: { file: "controllers/users.controller.ts", line: 6 },
        }),
      );

      await annotateSourceFiles(graph, { baseDir: tempDir });

      const content = readTestFile("controllers/users.controller.ts");
      expect(content).toContain("@contract UsersController.create");
    });

    it("handles Drizzle schema definition", async () => {
      createTestFile(
        "db/schema.ts",
        `import { pgTable, serial, varchar } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }),
});`,
      );

      const graph = new ContractGraph();
      graph.addContract(
        createContract("DB.users", {
          location: { file: "db/schema.ts", line: 3 },
        }),
      );

      await annotateSourceFiles(graph, { baseDir: tempDir });

      const content = readTestFile("db/schema.ts");
      expect(content).toContain("@contract DB.users");
    });
  });
});
