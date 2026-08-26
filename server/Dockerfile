# OpenSignage — CMS-Backend Image
FROM node:22-alpine AS base
WORKDIR /app

# Abhängigkeiten (Layer-Caching)
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && cp -R node_modules /prod_node_modules \
    && npm install

# Build (TypeScript → dist)
FROM deps AS build
COPY tsconfig.json drizzle.config.ts ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

# Runtime
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /prod_node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY package.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 3000
# Das Startskript reicht Zugangsdaten aus Dateien nach (falls nicht als Umgebungs-
# variable gesetzt) und wartet, bis die Datenbank Verbindungen annimmt. Ohne dieses
# Warten scheitert die erste Migration bei einem frischen Datentraeger, weil Postgres
# dann noch initialisiert.
ENTRYPOINT ["/docker-entrypoint.sh"]
# Migrationen laufen beim Start, dann Server.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
