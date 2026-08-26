# Admin-Oberflaeche + Player: im Container bauen und von nginx ausliefern.
#
# Warum im Container? Damit ein Fremder das Projekt mit einem einzigen
# `docker compose up -d` starten kann, ohne Node auf dem Server zu installieren
# und ohne die Oberflaeche vorher irgendwo zu bauen.
#
# Der TLS-Schluessel wird beim Start erzeugt, falls keiner vorliegt (siehe entrypoint.sh) -
# so laeuft HTTPS ohne Handarbeit, und wer ein echtes Zertifikat hat, legt es einfach dazu.

# --- 1) Bauen ---------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
# Erst nur die Abhaengigkeiten: so bleibt der Cache stehen, solange sich nichts daran aendert.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- 2) Ausliefern ----------------------------------------------------------
FROM nginx:alpine
RUN apk add --no-cache openssl
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-entrypoint.sh /docker-entrypoint-opensignage.sh
RUN chmod +x /docker-entrypoint-opensignage.sh
ENTRYPOINT ["/docker-entrypoint-opensignage.sh"]
CMD ["nginx", "-g", "daemon off;"]
