#!/usr/bin/env bash
set -euo pipefail

# Rachel8 installer — curl | bash entry point.
# Wrapped in main() to prevent partial-download execution (Pitfall 3).

main() {
  echo ""
  echo "  Rachel8 Installer"
  echo "  =================="
  echo ""

  # ── Prerequisites ──────────────────────────────────────────────────────────

  if ! command -v bun >/dev/null 2>&1; then
    echo "Error: Bun is required but not installed."
    echo "Install it: curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi

  if ! command -v git >/dev/null 2>&1; then
    echo "Error: git is required but not installed."
    echo "Install it: sudo apt install git"
    exit 1
  fi

  if ! command -v claude >/dev/null 2>&1; then
    echo "Error: Claude Code is required but not installed."
    echo "Install it: curl -fsSL https://claude.ai/install.sh | bash"
    echo "Then log in: claude login"
    exit 1
  fi

  INSTALL_DIR="$HOME/rachel8"

  if [ -d "$INSTALL_DIR" ]; then
    echo "Error: $INSTALL_DIR already exists."
    echo "To reinstall: rm -rf $INSTALL_DIR && run this script again"
    exit 1
  fi

  # ── Clone and setup ────────────────────────────────────────────────────────

  echo "Cloning Rachel8..."
  git clone https://github.com/OWNER/rachel8.git "$INSTALL_DIR"
  cd "$INSTALL_DIR"

  echo "Installing dependencies..."
  bun install

  # ── Launch wizard ──────────────────────────────────────────────────────────

  echo ""
  echo "Launching setup wizard..."
  bun run setup
}

main "$@"
