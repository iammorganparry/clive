# Stage 1: Install dependencies (cached layer)
FROM node:22-slim AS deps

RUN apt-get update && apt-get install -y git python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

# Copy dependency manifests first for caching
COPY package.json yarn.lock ./

# Apps
COPY apps/worker/package.json ./apps/worker/
COPY apps/slack/package.json ./apps/slack/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/tui/package.json ./apps/tui/
COPY apps/extension/package.json ./apps/extension/
COPY apps/claude-code-plugin/package.json ./apps/claude-code-plugin/

# Packages
COPY packages/worker-protocol/package.json ./packages/worker-protocol/
COPY packages/claude-services/package.json ./packages/claude-services/
COPY packages/github-app/package.json ./packages/github-app/
COPY packages/api/package.json ./packages/api/
COPY packages/core/package.json ./packages/core/
COPY packages/db/package.json ./packages/db/
COPY packages/auth/package.json ./packages/auth/
COPY packages/validators/package.json ./packages/validators/
COPY packages/prompts/package.json ./packages/prompts/
COPY packages/ui/package.json ./packages/ui/
COPY packages/memory/package.json ./packages/memory/
COPY packages/webview-rpc/package.json ./packages/webview-rpc/
COPY packages/contract-graph/package.json ./packages/contract-graph/

# Tooling
COPY tooling/biome/package.json ./tooling/biome/
COPY tooling/github/package.json ./tooling/github/
COPY tooling/tailwind/package.json ./tooling/tailwind/
COPY tooling/typescript/package.json ./tooling/typescript/

RUN yarn install --frozen-lockfile

# Stage 2: Full repo + build
FROM node:22-slim

# Runtime dependencies: git, curl, gh CLI
RUN apt-get update && \
    apt-get install -y git curl && \
    rm -rf /var/lib/apt/lists/*

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null && \
    apt-get update && \
    apt-get install -y gh && \
    rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /workspace

# Copy node_modules from deps stage
COPY --from=deps /workspace/node_modules ./node_modules

# Copy entire monorepo (Claude CLI needs full repo access)
COPY . .

# Build required packages for the worker
RUN npx tsc --project packages/github-app/tsconfig.json || true && \
    npx tsc --project packages/worker-protocol/tsconfig.json || true && \
    npx tsc --project packages/claude-services/tsconfig.json || true

# Create worktree directory for per-session isolation
RUN mkdir -p /workspace/worktrees

# Switch to non-root user (node:22-slim provides UID 1000 'node' user).
# Claude CLI refuses --dangerously-skip-permissions / bypassPermissions as root.
# Matches Anthropic's reference devcontainer pattern.
RUN chown -R node:node /workspace
USER node

# Initialize a fallback git repo for Claude CLI when CLIVE_REPO is not set.
# When CLIVE_REPO IS set, setupRepo() clones the target repo and uses worktrees instead.
RUN git init && \
    git config user.email "clive@railway.app" && \
    git config user.name "Clive Worker" && \
    git add -A && \
    git commit -m "Initial workspace" --quiet

ENV NODE_ENV=production

WORKDIR /workspace/apps/worker

CMD ["npx", "tsx", "src/index.ts"]
