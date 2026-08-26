#!/bin/sh
# Erzeugt beim allerersten Start die Geheimnisse dieser Installation.
#
# WARUM ueberhaupt ein eigener Container dafuer:
# Docker Compose liest die Datei .env, BEVOR irgendein Container laeuft. Ein Skript, das
# vorher Geheimnisse erzeugt, muesste also der Anwender selbst starten - genau das soll
# entfallen. Deshalb legt dieser Container die Werte in einem gemeinsamen Datentraeger ab;
# Datenbank und CMS lesen sie von dort.
#
# Ergebnis: `docker compose up -d` genuegt, und trotzdem hat JEDE Installation eigene,
# zufaellige Geheimnisse - kein ausgeliefertes Standardkennwort, das im Internet steht.
set -e

DIR="${SECRETS_DIR:-/run/opensignage-secrets}"
mkdir -p "$DIR"

# 32 Byte Zufall aus dem Betriebssystem, base64-kodiert und auf unbedenkliche
# Zeichen reduziert. Keine Sonderzeichen: das Kennwort landet in einer
# Verbindungs-URL, wo z. B. '@' oder '/' die Zerlegung zerstoeren wuerden.
gen() {
  head -c 48 /dev/urandom | base64 | tr -d '\n=+/' | cut -c1-40
}

make_secret() {
  f="$DIR/$1"
  if [ -s "$f" ]; then
    echo "[init] $1: vorhanden, bleibt unveraendert."
  else
    gen > "$f"
    chmod 600 "$f"
    echo "[init] $1: neu erzeugt."
  fi
}

make_secret db_password
make_secret session_secret

# Der Postgres-Container laeuft unter eigener Kennung und muss das Kennwort lesen koennen.
chmod 644 "$DIR/db_password"

echo "[init] Geheimnisse liegen in $DIR und ueberdauern Neustarts und Updates."
echo "[init] Zum Sichern: das Docker-Volume 'secrets' mitsichern - ohne db_password"
echo "[init] laesst sich eine gesicherte Datenbank nicht mehr oeffnen."
