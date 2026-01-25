# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install dependencies for the entire monorepo
COPY package.json yarn.lock ./
COPY apps/slack/package.json ./apps/slack/
COPY packages/worker-protocol/package.json ./packages/worker-protocol/
COPY packages/claude-services/package.json ./packages/claude-services/

# Install all dependencies
RUN yarn install --frozen-lockfile

# Copy source files
COPY apps/slack ./apps/slack
COPY packages/worker-protocol ./packages/worker-protocol
COPY packages/claude-services ./packages/claude-services
COPY tsconfig.json ./

# Build packages
RUN yarn workspace @clive/worker-protocol build || true
RUN yarn workspace @clive/claude-services build || true

# Production stage
FROM node:20-slim

WORKDIR /app

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/slack ./apps/slack
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./

WORKDIR /app/apps/slack

# Expose port
EXPOSE 3000

# Start the app
CMD ["npx", "tsx", "src/index.ts"]
