#!/usr/bin/env bash
# =============================================================================
#  OpenSignage aktualisieren  /  update OpenSignage
# =============================================================================
#
#   bash deploy/update.sh
#
#  Holt den aktuellen Stand, baut neu und startet die Dienste durch. Bricht ab,
#  bevor etwas angefasst wird, wenn es lokale Aenderungen gibt - sonst wuerde ein
#  Update stillschweigend eigene Anpassungen verwerfen.
#
#  Die Datenbank wird VORHER gesichert. Migrationen laufen beim Start des CMS.
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- 1) Eigene Aenderungen? --------------------------------------------------
if [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  echo "ABBRUCH: Es gibt lokale Aenderungen am Quelltext." >&2
  echo "Ein Update wuerde sie ueberschreiben. Erst sichern oder verwerfen:" >&2
  echo "  git stash        # beiseitelegen" >&2
  echo "  git checkout .   # verwerfen" >&2
  exit 1
fi

BEFORE="$(git rev-parse --short HEAD 2>/dev/null || echo '?')"

# --- 2) Sicherung ------------------------------------------------------------
# Vor dem Update, nicht danach: nach einer fehlgeschlagenen Migration ist eine
# Sicherung von "vorher" das Einzige, was noch hilft.
say "1/4  Datenbank sichern"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p backups
if docker compose ps --status running --services 2>/dev/null | grep -qx db; then
  docker compose exec -T db sh -lc \
    'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "backups/vor-update-$STAMP.sql"
  echo "    backups/vor-update-$STAMP.sql ($(du -h "backups/vor-update-$STAMP.sql" | cut -f1))"
else
  echo "    Datenbank laeuft nicht - keine Sicherung noetig."
fi

# --- 3) Neuen Stand holen ----------------------------------------------------
say "2/4  Neuen Stand holen"
git pull --ff-only
AFTER="$(git rev-parse --short HEAD)"
if [ "$BEFORE" = "$AFTER" ]; then
  echo "    Bereits aktuell ($AFTER). Es wird trotzdem neu gebaut."
else
  echo "    $BEFORE -> $AFTER"
  git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/      /'
fi

# --- 4) Bauen und starten ----------------------------------------------------
say "3/4  Neu bauen"
docker compose build

say "4/4  Dienste durchstarten"
docker compose up -d

# Kurz warten und den Zustand zeigen - ein stiller Fehlstart soll auffallen.
sleep 5
docker compose ps
say "Fertig. Bei Problemen:  docker compose logs -f cms"
