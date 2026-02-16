#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Rachel8 — Stop Per-User Container
# Stops and optionally removes a user's container and its data volume.
#
# Usage: USER_ID=123 ./stop-container.sh [--remove]
#   --remove: Also remove the container and volume (destructive!)
# ==============================================================================

if [[ -z "${USER_ID:-}" ]]; then
  echo "ERROR: USER_ID is required"
  echo "Usage: USER_ID=123 $0 [--remove]"
  exit 1
fi

CONTAINER_NAME="rachel-user-${USER_ID}"
VOLUME_NAME="rachel-user-${USER_ID}-data"
REMOVE=false

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --remove) REMOVE=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Stop container
if docker container inspect "${CONTAINER_NAME}" &>/dev/null; then
  echo "Stopping container: ${CONTAINER_NAME}"
  docker stop "${CONTAINER_NAME}"

  if [[ "$REMOVE" == "true" ]]; then
    echo "Removing container: ${CONTAINER_NAME}"
    docker rm "${CONTAINER_NAME}"

    echo "Removing volume: ${VOLUME_NAME}"
    docker volume rm "${VOLUME_NAME}" 2>/dev/null || echo "Volume ${VOLUME_NAME} not found or in use"

    echo "Container and volume removed for user ${USER_ID}"
  else
    echo "Container stopped. Data preserved in volume: ${VOLUME_NAME}"
    echo "To remove entirely: USER_ID=${USER_ID} $0 --remove"
  fi
else
  echo "Container ${CONTAINER_NAME} not found"
  exit 0
fi
