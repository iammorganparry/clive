import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const Post = pgTable("post", (t) => ({
  id: t.uuid().notNull().primaryKey().defaultRandom(),
  title: t.varchar({ length: 256 }).notNull(),
  content: t.text().notNull(),
  createdAt: t.timestamp().defaultNow().notNull(),
  updatedAt: t
    .timestamp({ mode: "date", withTimezone: true })
    .$onUpdateFn(() => sql`now()`),
}));

export const CreatePostSchema = createInsertSchema(Post, {
  title: z.string().max(256),
  content: z.string().max(256),
}).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Better Auth tables
/**
 * @contract DB.user
 * @see contracts/system.md#DB.user
 */
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

/**
 * @contract DB.session
 * @see contracts/system.md#DB.session
 */
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  activeOrganizationId: text("active_organization_id"), // Better Auth organization plugin
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

/**
 * @contract DB.account
 * @see contracts/system.md#DB.account
 */
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

// Better Auth JWT plugin table
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
});

// Better Auth Organization plugin tables
/**
 * @contract DB.organization
 * @see contracts/system.md#DB.organization
 */
export const organization = pgTable("organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  metadata: text("metadata"), // JSON for custom fields
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * @contract DB.member
 * @see contracts/system.md#DB.member
 */
export const member = pgTable("member", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner, admin, member
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const invitation = pgTable("invitation", {
  id: text("id").primaryKey(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  status: text("status").notNull().default("pending"), // pending, accepted, rejected, cancelled
  inviterId: text("inviter_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Better Auth Device Authorization plugin table
export const deviceCode = pgTable("device_code", {
  id: text("id").primaryKey(),
  deviceCode: text("device_code").notNull(),
  userCode: text("user_code").notNull(),
  userId: text("user_id"),
  expiresAt: timestamp("expires_at").notNull(),
  status: text("status").notNull(),
  lastPolledAt: timestamp("last_polled_at"),
  pollingInterval: integer("polling_interval"),
  clientId: text("client_id"),
  scope: text("scope"),
});

export const conversationStatusEnum = pgEnum("conversation_status", [
  "planning",
  "confirmed",
  "completed",
]);

export const conversationTypeEnum = pgEnum("conversation_type", [
  "branch",
  "uncommitted",
  "file",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const knowledgeBaseCategoryEnum = pgEnum("knowledge_base_category", [
  "framework",
  "patterns",
  "mocks",
  "fixtures",
  "selectors",
  "routes",
  "assertions",
  "hooks",
  "utilities",
  "coverage",
  "gaps",
  "improvements",
]);

/**
 * @contract DB.conversation
 * @see contracts/system.md#DB.conversation
 */
export const conversation = pgTable("conversation", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sourceFile: text("source_file"), // Deprecated: kept for backward compatibility
  branchName: text("branch_name"),
  baseBranch: text("base_branch").default("main"),
  sourceFiles: text("source_files"), // JSON array of file paths
  conversationType: conversationTypeEnum("conversation_type")
    .notNull()
    .default("file"),
  commitHash: text("commit_hash"), // HEAD commit hash for uncommitted conversations
  status: conversationStatusEnum("status").notNull().default("planning"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

/**
 * @contract DB.conversationMessage
 * @see contracts/system.md#DB.conversationMessage
 */
export const conversationMessage = pgTable("conversation_message", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => conversation.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"), // JSON string of tool calls if any
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Codebase indexing tables
/**
 * @contract DB.repositories
 * @see contracts/system.md#DB.repositories
 */
export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  organizationId: text("organization_id").references(() => organization.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(), // workspace name
  rootPath: text("root_path").notNull(), // absolute path on user's machine
  lastIndexedAt: timestamp("last_indexed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdateFn(() => sql`now()`),
});

/**
 * @contract DB.files
 * @see contracts/system.md#DB.files
 */
export const files = pgTable(
  "files",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    content: text("content").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(), // text-embedding-3-small
    fileType: text("file_type").notNull(),
    contentHash: text("content_hash").notNull(), // MD5 for change detection
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // HNSW index for fast vector similarity search
    index("files_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    // Unique index for repository + path lookups (required for ON CONFLICT)
    uniqueIndex("files_repo_path_unique_idx").on(
      table.repositoryId,
      table.relativePath,
    ),
  ],
);

// Testing knowledge base table
/**
 * @contract DB.knowledgeBase
 * @see contracts/system.md#DB.knowledgeBase
 */
export const knowledgeBase = pgTable(
  "knowledge_base",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id, { onDelete: "cascade" }),
    category: knowledgeBaseCategoryEnum("category").notNull(),
    title: text("title").notNull(), // Short title for the knowledge entry
    content: text("content").notNull(), // AI-generated summary/description
    examples: text("examples"), // JSON array of code examples
    sourceFiles: text("source_files"), // JSON array of files this knowledge was derived from
    embedding: vector("embedding", { dimensions: 1536 }).notNull(), // text-embedding-3-small for semantic search
    contentHash: text("content_hash").notNull(), // For change detection during regeneration
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => sql`now()`),
  },
  (table) => [
    // HNSW index for fast vector similarity search
    index("knowledge_base_embedding_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
    // Index for category-based filtering
    index("knowledge_base_repo_category_idx").on(
      table.repositoryId,
      table.category,
    ),
  ],
);
