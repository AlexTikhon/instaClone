FROM node:24.11.1-alpine AS builder
WORKDIR /workspace
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN pnpm build:packages && pnpm db:generate && pnpm --filter @instaclone/api build
RUN pnpm --filter @instaclone/api deploy --prod /release

FROM node:24.11.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /release ./
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
