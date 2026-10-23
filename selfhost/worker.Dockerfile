# Suite CXO background worker (hetzner-worker/index.ts) for a self-hosted box.
# Same code the Hetzner worker runs under pm2; here Docker restarts it instead.
# Build from the repo root:  docker build -f selfhost/worker.Dockerfile -t suitecxo-worker .
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx is a dev dependency and the worker runs TypeScript directly, so keep dev deps.
RUN npm ci --no-audit --no-fund --include=dev
COPY tsconfig.json ./
COPY lib ./lib
COPY types ./types
COPY hetzner-worker ./hetzner-worker
COPY selfhost/licence/licence.mjs selfhost/licence/check.mjs /selfhost-licence/
RUN useradd -r -u 1001 suitecxo
USER suitecxo
CMD ["node", "/selfhost-licence/check.mjs", "worker", "--", "npx", "tsx", "hetzner-worker/index.ts"]
