#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Rachel8 — Launch Per-User Container
# Creates an isolated, resource-limited, security-hardened container for one user.
#
# Required env vars:
#   USER_ID                  - Unique user identifier
#   TELEGRAM_BOT_TOKEN       - User's Telegram bot token (from BotFather)
#   OWNER_TELEGRAM_USER_ID   - User's Telegram numeric user ID
#
# Optional env vars:
#   IMAGE                    - Docker image (default: rachel8:latest)
#   ANTHROPIC_BASE_URL       - LLM proxy URL
#   ANTHROPIC_AUTH_TOKEN     - LLM auth token
#   GROQ_API_KEY             - Groq API key for STT
#   MEMORY_LIMIT             - Memory limit (default: 512m)
#   CPU_LIMIT                - CPU limit (default: 0.5)
#
# Usage: USER_ID=123 TELEGRAM_BOT_TOKEN=xxx OWNER_TELEGRAM_USER_ID=456 ./run-container.sh
# ==============================================================================

# Validate required environment variables
missing=()
[[ -z "${USER_ID:-}" ]] && missing+=("USER_ID")
[[ -z "${TELEGRAM_BOT_TOKEN:-}" ]] && missing+=("TELEGRAM_BOT_TOKEN")
[[ -z "${OWNER_TELEGRAM_USER_ID:-}" ]] && missing+=("OWNER_TELEGRAM_USER_ID")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required environment variables:"
  for var in "${missing[@]}"; do
    echo "  - ${var}"
  done
  echo ""
  echo "Usage: USER_ID=123 TELEGRAM_BOT_TOKEN=xxx OWNER_TELEGRAM_USER_ID=456 $0"
  exit 1
fi

# Derived names
CONTAINER_NAME="rachel-user-${USER_ID}"
VOLUME_NAME="rachel-user-${USER_ID}-data"
NETWORK_NAME="rachel-net"
IMAGE="${IMAGE:-rachel8:latest}"
MEMORY_LIMIT="${MEMORY_LIMIT:-512m}"
CPU_LIMIT="${CPU_LIMIT:-0.5}"

# Create isolated network (ICC disabled = no cross-container communication)
if ! docker network inspect "${NETWORK_NAME}" &>/dev/null; then
  echo "Creating network: ${NETWORK_NAME}"
  docker network create \
    --driver=bridge \
    --opt com.docker.network.bridge.enable_icc=false \
    "${NETWORK_NAME}"
fi

# Create named volume for user data (SQLite, memory files)
if ! docker volume inspect "${VOLUME_NAME}" &>/dev/null; then
  echo "Creating volume: ${VOLUME_NAME}"
  docker volume create "${VOLUME_NAME}"
fi

# Stop and remove existing container if present (enables re-deploy)
if docker container inspect "${CONTAINER_NAME}" &>/dev/null; then
  echo "Stopping existing container: ${CONTAINER_NAME}"
  docker stop "${CONTAINER_NAME}" 2>/dev/null || true
  docker rm "${CONTAINER_NAME}" 2>/dev/null || true
fi

# Launch container with full isolation and security hardening
echo "Starting container: ${CONTAINER_NAME}"
docker run -d \
  --name="${CONTAINER_NAME}" \
  --restart=unless-stopped \
  --network="${NETWORK_NAME}" \
  --memory="${MEMORY_LIMIT}" \
  --memory-swap="${MEMORY_LIMIT}" \
  --cpus="${CPU_LIMIT}" \
  --user=1001:1001 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=100m \
  -v "${VOLUME_NAME}:/data:rw" \
  -e TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN}" \
  -e OWNER_TELEGRAM_USER_ID="${OWNER_TELEGRAM_USER_ID}" \
  -e SHARED_FOLDER_PATH=/data \
  -e NODE_ENV=production \
  -e LOG_LEVEL=info \
  ${ANTHROPIC_BASE_URL:+-e ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL}"} \
  ${ANTHROPIC_AUTH_TOKEN:+-e ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN}"} \
  ${GROQ_API_KEY:+-e GROQ_API_KEY="${GROQ_API_KEY}"} \
  "${IMAGE}"

echo ""
echo "Container started successfully!"
echo "  Container:  ${CONTAINER_NAME}"
echo "  Image:      ${IMAGE}"
echo "  Volume:     ${VOLUME_NAME}"
echo "  Network:    ${NETWORK_NAME}"
echo "  Memory:     ${MEMORY_LIMIT}"
echo "  CPU:        ${CPU_LIMIT}"
echo ""
echo "View logs:    docker logs -f ${CONTAINER_NAME}"
echo "Stop:         docker stop ${CONTAINER_NAME}"
echo "Shell:        docker exec -it ${CONTAINER_NAME} sh"
