CREATE TYPE "public"."conversation_status" AS ENUM('planning', 'confirmed', 'completed');--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "status" SET DEFAULT 'planning'::"public"."conversation_status";--> statement-breakpoint
ALTER TABLE "conversation" ALTER COLUMN "status" SET DATA TYPE "public"."conversation_status" USING "status"::"public"."conversation_status";