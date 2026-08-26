-- Geraete-Geheimnis je Display. NULL = Altgeraet (laeuft unveraendert weiter, Trust-on-first-use).
ALTER TABLE "displays" ADD COLUMN IF NOT EXISTS "device_secret_hash" text;
