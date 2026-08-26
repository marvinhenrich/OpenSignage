#!/usr/bin/env bash
# OpenSignage — Sicherung (PostgreSQL-Dump + Medien). Als root/sudo ausführen (docker).
# Legt ein rotierendes Archiv unter $BK ab. Für täglichen Cron gedacht.
set -euo pipefail

BK="${BACKUP_DIR:-/home/signageadmin/opensignage-backups}"
KEEP="${KEEP:-14}"          # wie viele Sicherungen behalten
DB_C=opensignage-db-1
CMS_C=opensignage-cms-1

mkdir -p "$BK"
TS=$(date +%Y%m%d-%H%M%S)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# 1) Datenbank (mit DROP/CREATE für sauberes Restore)
docker exec "$DB_C" pg_dump --clean --if-exists -U opensignage opensignage | gzip > "$work/db.sql.gz"

# 2) Medien (aus dem CMS-Container, der das Volume unter /data/media mountet)
docker exec "$CMS_C" tar czf - -C /data/media . > "$work/media.tar.gz"

# 3) Zu einem Archiv bündeln
out="$BK/opensignage-backup-$TS.tar.gz"
tar czf "$out" -C "$work" db.sql.gz media.tar.gz
echo "Backup erstellt: $out ($(du -h "$out" | cut -f1))"

# 4) Rotation: nur die neuesten $KEEP behalten
ls -1t "$BK"/opensignage-backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
