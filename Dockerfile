# ==============================================================================
# Rachel8 — Personal AI Agent Docker Image
# ==============================================================================
# Multi-stage build for production deployment.
# Expected image size: ~280MB (Alpine-based)
#
# IMPORTANT: Secrets (TELEGRAM_BOT_TOKEN, API keys, etc.) must be passed via
# runtime env vars (-e flags), NOT baked into this image.
#
# Build:  ./scripts/build.sh
# Run:    ./scripts/run-container.sh
# ==============================================================================

# ==============================================================================
# STAGE 1: Builder — install dependencies
# ==============================================================================
FROM oven/bun:1.1.10-alpine AS builder

WORKDIR /build

# Copy dependency files first (layer caching — deps only reinstall when lockfile changes)
COPY package.json bun.lock ./

# Install production dependencies only (reproducible via frozen lockfile)
RUN bun install --frozen-lockfile --production

# Copy application source
COPY src ./src
COPY skills ./skills
COPY tsconfig.json .

# ==============================================================================
# STAGE 2: Runtime — minimal production image
# ==============================================================================
FROM oven/bun:1.1.10-alpine AS runtime

# Install runtime system dependencies (single RUN layer to minimize image size)
# - git: Required by Claude Agent SDK for tool execution
# - ffmpeg: Media processing (audio/video)
# - python3 + py3-pillow: Image processing (Alpine package, NOT pip — saves 180MB)
RUN apk add --no-cache \
    git \
    ffmpeg \
    python3 \
    py3-pillow \
  && rm -rf /var/cache/apk/*

# Create non-root user and data directory
# oven/bun:alpine already has group 1000 (bun), so we use a different GID
RUN addgroup -g 1001 rachel && \
    adduser -D -u 1001 -G rachel rachel && \
    mkdir -p /data && chown rachel:rachel /data

WORKDIR /app

# Copy production files from builder
COPY --from=builder --chown=1001:1001 /build/node_modules ./node_modules
COPY --from=builder --chown=1001:1001 /build/package.json .
COPY --from=builder --chown=1001:1001 /build/src ./src
COPY --from=builder --chown=1001:1001 /build/skills ./skills
COPY --from=builder --chown=1001:1001 /build/tsconfig.json .

# CRITICAL: Create .env stub file.
# Rachel8's src/config/env.ts calls existsSync(".env") and exits if missing.
# In Docker, env vars are passed via -e flags. This empty file satisfies the
# existence check while Bun.env picks up runtime env vars normally.
RUN touch /app/.env && chown 1001:1001 /app/.env

# Switch to non-root user
USER rachel

# Declare volume for per-user persistent data (SQLite, memory files)
VOLUME ["/data"]

# Default environment variables
ENV NODE_ENV=production \
    SHARED_FOLDER_PATH=/data \
    LOG_LEVEL=info

# Health check — verify the Bun process is running
# start-period is 15s because Rachel8 initializes memory system + Telegram connection
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD pgrep -f "bun.*index.ts" || exit 1

# No EXPOSE — Rachel8 uses outbound Telegram polling, no inbound ports needed

CMD ["bun", "run", "src/index.ts"]
