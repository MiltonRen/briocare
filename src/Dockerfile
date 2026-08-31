# The Brio media worker, for LiveKit Cloud Agents (`lk agent create/deploy`
# from src/ — see docs/demo-script.md and README). Build context is src/
# because the worker imports @briocare/backend (generated api types +
# personas), so the whole npm workspace installs.
FROM node:22-slim

# rtc-node's native (Rust) core does its own TLS against the OS root-CA
# store, which slim images ship EMPTY — without this, worker registration
# succeeds (Node's bundled CAs) but every Room.connect fails with
# "no native root CA certificates found".
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace manifests first — layer-cached npm ci unless deps change.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY worker/package.json worker/
COPY web/package.json web/
# npm ci includes devDependencies by default — tsx (the runner) is one.
RUN npm ci

COPY . .

# LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET are injected by LiveKit
# Cloud; OPENAI_API_KEY and CONVEX_URL come from `lk agent` secrets. There is
# no .env.local in the image (.dockerignore) — dotenv no-ops and the injected
# environment wins.
CMD ["npx", "tsx", "worker/src/agent.ts", "start"]
