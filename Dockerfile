# QuantEdge — one image, two entrypoints.
#
# The build emits dist/web.js (HTTP) and dist/worker.js (background jobs) plus
# dist/public (the Vite client). Both services run from THIS image; they differ
# only by command and env:
#
#   web     node dist/web.js       WORKER_ENABLED=true   (may scale to N)
#   worker  node dist/worker.js                          (exactly 1 instance)
#
# Run the worker at one instance. It holds a Postgres advisory lock so a second
# one cannot double-schedule (see server/scheduler-lock.ts), but a spare
# instance idles doing nothing useful.

FROM node:22-slim AS build
WORKDIR /app

# Install with dev deps — vite and esbuild are needed to build.
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Bind all interfaces. server/index.ts defaults HOST to 127.0.0.1, which is
# correct locally and unreachable inside a container.
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Most platforms inject PORT; the app falls back to 5000.
EXPOSE 5000

# Overridden to `node dist/worker.js` for the worker service.
CMD ["node", "dist/web.js"]
