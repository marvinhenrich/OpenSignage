#!/usr/bin/env bash
# OpenSignage — Wiederherstellung aus einer Sicherung. Als root/sudo ausführen.
# ACHTUNG: überschreibt Datenbank UND Medien mit dem Stand des Backups.
#   Aufruf: sudo bash restore.sh /pfad/opensignage-backup-YYYYMMDD-HHMMSS.tar.gz
set -euo pipefail

FILE="${1:-}"
[ -f "$FILE" ] || { echo "Backup-Datei angeben: restore.sh <archiv.tar.gz>"; exit 1; }
DB_C=opensignage-db-1
CMS_C=opensignage-cms-1

read -r -p "Wirklich Datenbank + Medien aus '$FILE' wiederherstellen? (ja/nein) " a
[ "$a" = "ja" ] || { echo "Abgebrochen."; exit 1; }

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
tar xzf "$FILE" -C "$work"

echo "== Datenbank wiederherstellen =="
gunzip -c "$work/db.sql.gz" | docker exec -i "$DB_C" psql -U opensignage -d opensignage >/dev/null

echo "== Medien wiederherstellen =="
docker exec -i "$CMS_C" sh -c 'rm -rf /data/media/* && mkdir -p /data/media && tar xzf - -C /data/media' < "$work/media.tar.gz"

echo "== CMS neu starten =="
docker restart "$CMS_C" >/dev/null
echo "Wiederherstellung abgeschlossen."
