#!/bin/sh
# Startpunkt des CMS-Containers.
#
# Aufgabe: Zugangsdaten aus Dateien nachreichen, damit `docker compose up -d` ohne
# vorheriges Bearbeiten einer .env genuegt. Der Init-Container erzeugt beim allerersten
# Start je Installation eigene Zufallsgeheimnisse; hier werden sie nur eingelesen.
#
# Wer die Werte lieber selbst setzt (z. B. eine externe Datenbank), setzt DATABASE_URL
# bzw. SESSION_SECRET als Umgebungsvariable - dann wird die Datei ignoriert.
set -e

SECRETS_DIR="${SECRETS_DIR:-/run/opensignage-secrets}"

# Ein Geheimnis aus einer Datei lesen, aber nur wenn die Variable noch leer ist.
load() {
  var="$1"; file="$SECRETS_DIR/$2"
  eval "cur=\$$var"
  if [ -z "$cur" ] && [ -s "$file" ]; then
    eval "export $var=\"\$(cat '$file')\""
  fi
}

load DB_PASSWORD db_password
# SESSION_SECRET wird vom Anwendungscode derzeit nicht ausgewertet (Sitzungen laufen
# ueber Zufallsmerkmale in der Datenbank). Der Wert wird trotzdem bereitgestellt, damit
# ein spaeterer Einsatz nichts am Betrieb aendert - aber er ist KEINE Startbedingung.
load SESSION_SECRET session_secret

# Aus den Einzelteilen die Verbindungszeichenkette bauen - aber nur, wenn nicht
# ohnehin eine vollstaendige DATABASE_URL vorgegeben wurde.
if [ -z "$DATABASE_URL" ]; then
  if [ -z "$DB_PASSWORD" ]; then
    echo "[opensignage] FEHLER: Weder DATABASE_URL noch ein Datenbankkennwort gefunden." >&2
    echo "[opensignage] Erwartet wurde die Datei $SECRETS_DIR/db_password (legt der init-Container an)." >&2
    exit 1
  fi
  export DATABASE_URL="postgres://${DB_USER:-opensignage}:${DB_PASSWORD}@${DB_HOST:-db}:${DB_PORT:-5432}/${DB_NAME:-opensignage}"
fi

# Warten, bis die Datenbank Verbindungen annimmt. Ohne das scheitert die erste
# Migration bei einem frischen Datentraeger, weil Postgres noch initialisiert.
i=0
while [ $i -lt 60 ]; do
  node -e "
    const p=require('postgres');const s=p(process.env.DATABASE_URL,{max:1,connect_timeout:3,onnotice(){}});
    s\`select 1\`.then(()=>s.end()).then(()=>process.exit(0)).catch(()=>process.exit(1));
  " 2>/dev/null && break
  i=$((i+1))
  [ $i -eq 1 ] && echo "[opensignage] Warte auf die Datenbank ..."
  sleep 2
done
if [ $i -ge 60 ]; then
  echo "[opensignage] FEHLER: Die Datenbank war nach 120 s nicht erreichbar (${DB_HOST:-db}:${DB_PORT:-5432})." >&2
  exit 1
fi

exec "$@"
