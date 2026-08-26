#!/usr/bin/env bash
# =============================================================================
#  Bestehende Installation uebernehmen  /  adopt an existing installation
# =============================================================================
#
#   bash deploy/migrate-existing.sh <alter-Projektname> [Pfad/zur/alten/.env]
#
#  Wofuer: Wer den Stapel bisher mit einer eigenen docker-compose.yml betrieben hat,
#  soll auf diese Fassung wechseln koennen, OHNE Datenbank und Medien neu aufzusetzen
#  und ohne dass die Anzeigegeraete etwas merken.
#
#  Was passiert:
#   1. Die vorhandenen Datentraeger werden gesucht und geprueft.
#   2. Das BISHERIGE Datenbankkennwort wird in den Datentraeger "secrets" geschrieben -
#      sonst wuerde der init-Container ein neues erzeugen und die bestehende Datenbank
#      liesse sich nicht mehr oeffnen.
#   3. Ein vorhandenes TLS-Zertifikat wird uebernommen. Das ist der wichtigste Schritt:
#      die Anzeigegeraete vertrauen genau diesem Zertifikat. Ein neues wuerde jedes
#      Geraet auf eine Zertifikatswarnung laufen lassen.
#
#  Es wird NICHTS geloescht und nichts ueberschrieben, was schon Inhalt hat.
# =============================================================================
set -euo pipefail

OLD_PROJECT="${1:-}"
OLD_ENV="${2:-}"

if [ -z "$OLD_PROJECT" ]; then
  cat >&2 <<'USAGE'
Aufruf: bash deploy/migrate-existing.sh <alter-Projektname> [alte/.env]

Der Projektname steht in der alten docker-compose.yml unter "name:" - oder er ist der
Ordnername, in dem sie liegt. Die vorhandenen Datentraeger heissen dann
<Projektname>_<Volumename>, zu sehen mit:

    docker volume ls
USAGE
  exit 1
fi

cd "$(dirname "$0")/.."
NEW_PROJECT="${COMPOSE_PROJECT_NAME:-$(grep -m1 '^name:' docker-compose.yml | awk '{print $2}')}"

echo "== Bestehende Installation uebernehmen =="
echo "   bisher: $OLD_PROJECT"
echo "   künftig: $NEW_PROJECT"
if [ "$OLD_PROJECT" != "$NEW_PROJECT" ]; then
  echo
  echo "HINWEIS: Die Namen sind verschieden. Damit die VORHANDENEN Datentraeger weiter"
  echo "benutzt werden, muss der Projektname gleich bleiben. Trage dazu in die .env ein:"
  echo "    COMPOSE_PROJECT_NAME=$OLD_PROJECT"
  echo "Sonst legt Compose leere Datentraeger an und die Anlage startet wie neu."
  echo
fi

vol() { docker volume inspect "$1" >/dev/null 2>&1; }

# --- 1) Vorhandene Datentraeger --------------------------------------------
echo "-- Vorhandene Datentraeger --"
for v in db_data media_data; do
  if vol "${OLD_PROJECT}_${v}"; then
    echo "   gefunden: ${OLD_PROJECT}_${v}"
  else
    echo "   FEHLT:    ${OLD_PROJECT}_${v}  (heisst er anders? 'docker volume ls')"
  fi
done

SECRETS="${OLD_PROJECT}_secrets"

# --- 2) Datenbankkennwort uebernehmen ---------------------------------------
echo
echo "-- Datenbankkennwort --"
PW=""
if [ -n "$OLD_ENV" ] && [ -f "$OLD_ENV" ]; then
  PW="$(grep -m1 '^POSTGRES_PASSWORD=' "$OLD_ENV" | cut -d= -f2- || true)"
fi
if [ -z "$PW" ]; then
  echo "   Kein Kennwort in einer .env gefunden."
  printf '   Bisheriges Datenbankkennwort eingeben (Eingabe bleibt unsichtbar): '
  read -rs PW; echo
fi
if [ -z "$PW" ]; then
  echo "ABBRUCH: Ohne das bisherige Kennwort laesst sich die vorhandene Datenbank nicht oeffnen." >&2
  exit 1
fi

docker volume create "$SECRETS" >/dev/null
EXISTING="$(docker run --rm -v "$SECRETS":/s alpine:3.20 sh -c 'cat /s/db_password 2>/dev/null || true')"
if [ -n "$EXISTING" ]; then
  if [ "$EXISTING" = "$PW" ]; then
    echo "   Kennwort liegt bereits richtig im Datentraeger."
  else
    echo "ABBRUCH: In $SECRETS liegt bereits ein ANDERES Kennwort." >&2
    echo "Das wird nicht ueberschrieben - sonst geht der Zugang zur Datenbank verloren." >&2
    exit 1
  fi
else
  printf '%s' "$PW" | docker run --rm -i -v "$SECRETS":/s alpine:3.20 \
    sh -c 'cat > /s/db_password && chmod 644 /s/db_password'
  echo "   Kennwort uebernommen."
fi

# --- 3) Zertifikat uebernehmen ----------------------------------------------
echo
echo "-- TLS-Zertifikat --"
CERTS="${OLD_PROJECT}_certs"
docker volume create "$CERTS" >/dev/null
HAVE="$(docker run --rm -v "$CERTS":/c alpine:3.20 sh -c 'ls /c/server.crt 2>/dev/null || true')"
if [ -n "$HAVE" ]; then
  echo "   Im Datentraeger liegt bereits ein Zertifikat - bleibt unveraendert."
else
  FOUND=""
  for d in deploy/nginx/certs ../deploy/nginx/certs /etc/opensignage/certs; do
    if [ -s "$d/server.crt" ] && [ -s "$d/server.key" ]; then FOUND="$d"; break; fi
  done
  if [ -n "$FOUND" ]; then
    docker run --rm -v "$CERTS":/c -v "$(cd "$FOUND" && pwd)":/src:ro alpine:3.20 \
      sh -c 'cp /src/server.crt /src/server.key /c/ && chmod 600 /c/server.key'
    echo "   Zertifikat aus $FOUND uebernommen."
  else
    echo "   KEIN vorhandenes Zertifikat gefunden."
    echo "   WICHTIG: Beim naechsten Start wird ein neues, selbstsigniertes erzeugt."
    echo "   Anzeigegeraete, die dem bisherigen Zertifikat vertrauen, laufen dann in eine"
    echo "   Warnung. Vorhandene server.crt/server.key vorher nach deploy/nginx/certs legen."
  fi
fi

echo
echo "== Bereit =="
echo "Naechster Schritt:"
[ "$OLD_PROJECT" != "$NEW_PROJECT" ] && echo "  echo 'COMPOSE_PROJECT_NAME=$OLD_PROJECT' >> .env"
echo "  docker compose up -d --build"
