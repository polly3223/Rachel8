#!/usr/bin/env bash
set -euo pipefail
[[ -f package.json && -f index.html ]] || { echo "Run from the Vite project root"; exit 1; }
bun add -d vite-plugin-singlefile
# Keep the project’s existing Vite plugins and aliases, including Tailwind.
bun -e 'import {build} from "vite"; import {viteSingleFile} from "vite-plugin-singlefile"; await build({plugins:[viteSingleFile()]});'
cp dist/index.html bundle.html
echo "Built bundle.html. Import local assets in source so Vite can inline them."
