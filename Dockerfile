# 1venue: small production image for Coolify (or any Docker host).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data STORAGE_DIR=/data/uploads NODE_OPTIONS=--max-old-space-size=384
WORKDIR /app
RUN apk add --no-cache tini && mkdir -p /data/uploads && chown -R node:node /data
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT}/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
# Migrations run automatically on boot (AUTO_MIGRATE=true by default).
CMD ["node", "server.js"]
