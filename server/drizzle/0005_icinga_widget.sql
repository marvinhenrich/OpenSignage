-- Neuer Widget-Typ fuer die Icinga-Statuskachel (Daten holt der CMS-Server per Icinga-2-API).
-- IF NOT EXISTS macht die Migration wiederholbar, falls sie zweimal laeuft.
ALTER TYPE "widget_type" ADD VALUE IF NOT EXISTS 'icinga';
