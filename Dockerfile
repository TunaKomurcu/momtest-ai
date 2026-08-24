# Multi-stage Dockerfile — MomTest AI (Next.js 16)
#
# Stages:
#   deps    — production dependencies only
#   builder — TypeScript compile + Next.js build
#   runner  — minimal production image (~200 MB)

ARG NODE_VERSION=20-alpine
FROM node:${NODE_VERSION} AS base

# ── Stage 1: deps ──────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

# ── Stage 2: builder ───────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Dummy values prevent lib/db/index.ts from throwing at build time.
# Real values are injected at runtime via environment variables.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV OPENAI_API_KEY="build-placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
# Limit Node heap to 512 MB so the build doesn't OOM on t3.micro (1 GB RAM).
ENV NODE_OPTIONS="--max-old-space-size=512"

RUN npm run build

# ── Stage 3: runner ────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# wget is required for the HEALTHCHECK command below
RUN apk add --no-cache wget

# Run as non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

RUN mkdir .next && chown nextjs:nodejs .next

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# openai.yaml is read via fs.readFileSync at runtime
COPY --from=builder --chown=nextjs:nodejs /app/mom-test-customer-discovery ./mom-test-customer-discovery

# Drizzle migrations
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/projects || exit 1

CMD ["node", "server.js"]
