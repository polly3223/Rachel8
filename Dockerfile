# ==============================================================================
# Rachel8 — Personal AI Agent Docker Image
# ==============================================================================
# Multi-stage build for production deployment.
# Uses Debian-based image (not Alpine) because Claude Code requires glibc.
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
FROM oven/bun:1.3.9 AS builder

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
# STAGE 2: Runtime — Debian-based production image
# ==============================================================================
FROM oven/bun:1.3.9 AS runtime

# Install runtime system dependencies
# - git: Required by Claude Agent SDK for tool execution
# - ffmpeg: Media processing (audio/video)
# - python3 + python3-pil: Image processing
# - curl: Required for Claude Code installation
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ffmpeg \
    python3 \
    python3-pil \
    curl \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (required by the Claude Agent SDK)
RUN curl -fsSL https://claude.ai/install.sh | bash \
  && cp /root/.local/bin/claude /usr/local/bin/claude \
  && chmod +x /usr/local/bin/claude \
  && rm -rf /root/.claude/downloads

# Create non-root user and data directory
RUN groupadd -g 1001 rachel && \
    useradd -u 1001 -g rachel -m rachel && \
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

# Entrypoint: copy Claude credentials from persistent volume if present, then start
# This allows containers to use direct Anthropic auth (Claude subscription) instead of proxy
RUN printf '#!/bin/bash\n\
if [ -f /data/.claude-credentials.json ]; then\n\
  mkdir -p /home/rachel/.claude\n\
  cp /data/.claude-credentials.json /home/rachel/.claude/.credentials.json\n\
  chmod 600 /home/rachel/.claude/.credentials.json\n\
fi\n\
exec bun run src/index.ts\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh && chown 1001:1001 /app/entrypoint.sh

# Switch to non-root user
USER rachel

# Declare volume for per-user persistent data (SQLite, memory files)
VOLUME ["/data"]

# Default environment variables
ENV NODE_ENV=production \
    SHARED_FOLDER_PATH=/data \
    LOG_LEVEL=info

# Health check — verify the Bun process is running
# Uses /proc/1/cmdline (always available) since pgrep/ps may not be in slim images
# start-period is 15s because Rachel8 initializes memory system + Telegram connection
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD cat /proc/1/cmdline 2>/dev/null | tr '\0' ' ' | grep -q "bun" || exit 1

# No EXPOSE — Rachel8 uses outbound Telegram polling, no inbound ports needed

CMD ["/app/entrypoint.sh"]
