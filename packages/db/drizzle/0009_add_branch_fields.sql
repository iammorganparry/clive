ALTER TABLE "conversation" ADD COLUMN "branch_name" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "base_branch" text DEFAULT 'main';--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "source_files" text;--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "source_file" DROP NOT NULL;

