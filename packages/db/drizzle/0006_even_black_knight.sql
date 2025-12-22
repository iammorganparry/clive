DROP INDEX "files_repo_path_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "files_repo_path_unique_idx" ON "files" USING btree ("repository_id","relative_path");