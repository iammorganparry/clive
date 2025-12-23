CREATE TABLE "knowledge_base" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"examples" text,
	"source_files" text,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD CONSTRAINT "knowledge_base_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_base_embedding_idx" ON "knowledge_base" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_base_repo_category_idx" ON "knowledge_base" USING btree ("repository_id","category");