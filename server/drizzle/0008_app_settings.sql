-- Organisationsweite Einstellungen als Schluessel/Wert-Tabelle.
-- BEWUSST eine Tabelle statt einer Spalte irgendwo: die Sprache ist die erste
-- Einstellung dieser Art, weitere (z.B. Zeitzone, Startseite) kommen ohne Migration dazu.
-- Sie gilt fuer ALLE Benutzer und fuer die Displays - nicht pro Benutzer, nicht pro Browser.
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" uuid
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Deutsch ist die Standardsprache und die Referenz.
INSERT INTO "app_settings" ("key", "value") VALUES ('language', 'de')
ON CONFLICT ("key") DO NOTHING;
