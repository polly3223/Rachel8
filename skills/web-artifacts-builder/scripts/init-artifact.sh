#!/usr/bin/env bash
set -euo pipefail
command -v bun >/dev/null || { echo "Bun is required"; exit 1; }
project_name="${1:?Usage: init-artifact.sh <project-name>}"
[[ "$project_name" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo "Use a lowercase project name"; exit 1; }
[[ ! -e "$project_name" ]] || { echo "Project already exists"; exit 1; }

# Let the maintained upstream template own Vite, Tailwind and component compatibility.
bun x --bun shadcn@latest init --template vite --base radix --preset nova \
  --name "$project_name" --yes --no-monorepo --no-rtl
cd "$project_name"
bun update --latest
bun -e 'const path="index.html"; await Bun.write(path,(await Bun.file(path).text()).replace(/<link[^>]+rel="icon"[^>]*>/g,""));'
echo "Ready: cd $project_name && bun run dev"
echo "Add only needed components: bun x --bun shadcn@latest add <component>"
