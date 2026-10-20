# One image for the site, the worker and the migrations.
# Works on PC (amd64) and Raspberry Pi 4/5 (arm64).
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Exact versions from the lockfile, no install scripts.
RUN npm ci --ignore-scripts --no-audit

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# PGlite is a test-only database: drop it even though drizzle-orm lists it as an optional peer.
RUN npm run build && npm prune --omit=dev --ignore-scripts && rm -rf node_modules/@electric-sql

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
COPY --from=build --chown=node:node /app/package.json /app/next.config.mjs ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
