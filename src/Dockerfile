# The Brio media worker, for LiveKit Cloud Agents (`lk agent create/deploy`
# from src/ — see docs/demo-script.md and README). Build context is src/
# because the worker imports @briocare/backend (generated api types +
# personas), so the whole npm workspace installs.
FROM node:22-slim

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
