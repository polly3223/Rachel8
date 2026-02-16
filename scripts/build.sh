#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Rachel8 Docker Image Build Script
# Builds and tags the Rachel8 production image.
# Usage: ./scripts/build.sh
# ==============================================================================

IMAGE_NAME="rachel8"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

GIT_SHORT_HASH="$(git -C "${REPO_ROOT}" rev-parse --short HEAD)"
GIT_TAG="$(git -C "${REPO_ROOT}" describe --tags --always 2>/dev/null || echo "${GIT_SHORT_HASH}")"
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "Building Rachel8 Docker image..."
echo "  Image:   ${IMAGE_NAME}"
echo "  Version: ${GIT_TAG}"
echo "  Commit:  ${GIT_SHORT_HASH}"
echo "  Date:    ${BUILD_DATE}"
echo ""

docker build \
  --tag "${IMAGE_NAME}:latest" \
  --tag "${IMAGE_NAME}:${GIT_SHORT_HASH}" \
  --label "org.opencontainers.image.created=${BUILD_DATE}" \
  --label "org.opencontainers.image.revision=${GIT_SHORT_HASH}" \
  --label "org.opencontainers.image.source=https://github.com/polly3223/Rachel8" \
  "${REPO_ROOT}"

echo ""
echo "Build complete!"
echo "  Tagged: ${IMAGE_NAME}:latest"
echo "  Tagged: ${IMAGE_NAME}:${GIT_SHORT_HASH}"
echo ""
echo "Image size:"
docker images "${IMAGE_NAME}:latest" --format "  {{.Size}}"
