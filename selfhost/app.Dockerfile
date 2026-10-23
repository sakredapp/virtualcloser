# Suite CXO app image for a self-hosted box (Next.js standalone, no Vercel).
# Build from the repo root:  docker build -f selfhost/app.Dockerfile -t suitecxo-app .
FROM node:22-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /src
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=4096
COPY --from=deps /src/node_modules ./node_modules
COPY . .
# next/font downloads the Google fonts at build time (the built image then needs
# no internet); that fetch is sometimes flaky, so try the build up to 3 times.
RUN cp selfhost/next.config.selfhost.mjs next.config.mjs \
 && (npx next build || (sleep 10 && npx next build) || (sleep 30 && npx next build))

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN useradd -r -u 1001 suitecxo
COPY --from=build --chown=suitecxo /src/.next/standalone ./
COPY --from=build --chown=suitecxo /src/.next/static ./.next/static
COPY --from=build --chown=suitecxo /src/public ./public
# The licence boot gate (offline): no valid licence at /licence/licence.key = no app.
COPY selfhost/licence/licence.mjs selfhost/licence/check.mjs /selfhost-licence/
USER suitecxo
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login',{headers:{host:'localhost'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "/selfhost-licence/check.mjs", "app", "--", "node", "server.js"]
