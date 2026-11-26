# syntax=docker/dockerfile:1
# CartridgeFi Protocol Frontend (@cartridgefi/web) — Google Cloud Run Production Image

FROM node:22-bookworm-slim AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

# Install exact pnpm version matching package.json & pnpm-lock.yaml
RUN npm install -g pnpm@12.21.0

# Copy workspace manifests first for deterministic Docker layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/cartridgefi-skill/package.json ./packages/cartridgefi-skill/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/codama-clients/package.json ./packages/codama-clients/package.json
COPY packages/mcp-server/package.json ./packages/mcp-server/package.json
COPY packages/react-deck/package.json ./packages/react-deck/package.json
COPY packages/sdk/package.json ./packages/sdk/package.json
COPY packages/shared-types/package.json ./packages/shared-types/package.json
COPY packages/ui-system/package.json ./packages/ui-system/package.json
COPY tests/e2e/package.json ./tests/e2e/package.json

RUN pnpm install --frozen-lockfile

# Copy TypeScript workspace packages and Next.js web app
COPY packages ./packages
COPY apps/web ./apps/web

# Public Solana Devnet & MagicBlock endpoints baked into Next.js client bundle
ARG NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ARG NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app
ARG NEXT_PUBLIC_MAGICBLOCK_TEE_URL=https://devnet-tee.magicblock.app
ENV NEXT_PUBLIC_SOLANA_RPC_URL=${NEXT_PUBLIC_SOLANA_RPC_URL}
ENV NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL=${NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL}
ENV NEXT_PUBLIC_MAGICBLOCK_TEE_URL=${NEXT_PUBLIC_MAGICBLOCK_TEE_URL}

# Build workspace packages and Next.js standalone server
RUN pnpm --filter "./packages/*" --filter @cartridgefi/web -r run build && \
    mkdir -p /app/apps/web/public

FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
ENV NEXT_PUBLIC_SOLANA_RPC_URL=https://api.devnet.solana.com
ENV NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL=https://devnet-router.magicblock.app
ENV NEXT_PUBLIC_MAGICBLOCK_TEE_URL=https://devnet-tee.magicblock.app

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 8080

CMD ["node", "apps/web/server.js"]
