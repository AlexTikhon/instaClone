FROM node:24.11.1-alpine AS base
RUN apk add --no-cache 'ffmpeg>=7'

FROM base AS builder
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/workers/package.json apps/workers/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build:packages && pnpm --filter @instaclone/workers build
RUN pnpm --filter @instaclone/workers deploy --prod /release

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /release ./
USER node
CMD ["node", "dist/main.js"]
