#!/bin/sh
# Startpunkt des Web-Containers.
#
# Aufgabe: HTTPS soll ohne Handarbeit funktionieren. Liegt kein Zertifikat vor, wird beim
# ersten Start ein selbstsigniertes erzeugt und im Datentraeger abgelegt - es ueberlebt damit
# Neustarts und Updates. Wer ein echtes Zertifikat hat, legt server.crt/server.key einfach
# in dasselbe Verzeichnis; dann wird nichts erzeugt.
#
# Bewusst KEIN automatisches Let's Encrypt: Digital-Signage steht typischerweise im internen
# Netz ohne oeffentlichen Namen - eine Zertifikatsstelle koennte dort gar nicht pruefen.
set -e

CERT_DIR="${CERT_DIR:-/etc/nginx/certs}"
CRT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"
CN="${PUBLIC_HOSTNAME:-opensignage.local}"

mkdir -p "$CERT_DIR"

if [ ! -s "$CRT" ] || [ ! -s "$KEY" ]; then
  echo "[opensignage] Kein TLS-Zertifikat gefunden - erzeuge ein selbstsigniertes fuer '$CN' (10 Jahre)."
  openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
    -keyout "$KEY" -out "$CRT" \
    -subj "/CN=$CN" \
    -addext "subjectAltName=DNS:$CN,DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1
  chmod 600 "$KEY"
  echo "[opensignage] Zertifikat erzeugt. Fuer den Kiosk-Betrieb dieses Zertifikat auf den"
  echo "[opensignage] Anzeigegeraeten als vertrauenswuerdig hinterlegen (siehe Anleitung)."
else
  echo "[opensignage] Vorhandenes TLS-Zertifikat wird verwendet."
fi

exec "$@"
