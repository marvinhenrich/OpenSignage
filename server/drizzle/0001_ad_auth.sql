CREATE TYPE "public"."auth_source" AS ENUM('local', 'ad');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_source" "auth_source" DEFAULT 'local' NOT NULL;