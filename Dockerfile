# 1venue: production image (Debian-based for reliable LibreOffice PPTX conversion).
# Mirrors the working teams stack: soffice + poppler-utils on slim, not Alpine.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-bookworm-slim
# NODE_MAX_OLD_SPACE_MB = V8 heap limit. Keep it ~65% of the container memory limit
# (docker-compose mem_limit / Coolify "Maximum Memory"): 2048 MB heap for a 3 GB container.
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data STORAGE_DIR=/data/uploads NODE_MAX_OLD_SPACE_MB=2048
WORKDIR /app

# LibreOffice headless (nogui) + poppler for pdftoppm — same recipe as teams.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tini \
      ca-certificates \
      curl \
      poppler-utils \
      fonts-dejavu-core \
      fonts-liberation \
      libreoffice-impress-nogui \
      libreoffice-writer-nogui \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data/uploads \
    && chown -R node:node /data

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

USER node
EXPOSE 3000
VOLUME ["/data"]
# /health = liveness (process up, no DB). /ready = database reachable (use it for external monitors).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health >/dev/null || exit 1
# Docker/Coolify send SIGTERM on deploy: the app snapshots live rooms and asks clients to reconnect.
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
# Migrations run automatically on boot (AUTO_MIGRATE=true by default).
CMD ["sh", "-c", "exec node --max-old-space-size=${NODE_MAX_OLD_SPACE_MB:-2048} server.js"]
