# syntax=docker/dockerfile:1.7
# ── deps: production node_modules only ──
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile --prod

# ── build: full install + tsc ──
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm build

# ── run: non-root, prod deps + compiled output ──
FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=8080 FIXTURES_DIR=/app/test/fixtures
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps --chown=node:node /app/packages/mcp-server/node_modules ./packages/mcp-server/node_modules
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/packages/core/package.json /app/packages/core/
COPY --from=build --chown=node:node /app/packages/core/dist /app/packages/core/dist
COPY --from=build --chown=node:node /app/packages/mcp-server/package.json /app/packages/mcp-server/
COPY --from=build --chown=node:node /app/packages/mcp-server/dist /app/packages/mcp-server/dist
COPY --from=build --chown=node:node /app/packages/mcp-server/drizzle /app/packages/mcp-server/drizzle
COPY --from=build --chown=node:node /app/packages/mcp-server/bin /app/packages/mcp-server/bin
COPY --chown=node:node test/fixtures /app/test/fixtures
WORKDIR /app/packages/mcp-server
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/v1/health" >/dev/null || exit 1
CMD ["node", "dist/server.js"]
