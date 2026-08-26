-- Verlauf der offenen Meldungen. In der DB, damit er CMS-Neustarts ueberlebt.
CREATE TABLE IF NOT EXISTS "icinga_history" (
  "id" serial PRIMARY KEY,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  "problems" integer DEFAULT 0 NOT NULL,
  "critical" integer DEFAULT 0 NOT NULL,
  "warning" integer DEFAULT 0 NOT NULL,
  "down" integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "icinga_history_at_idx" ON "icinga_history" ("at");
