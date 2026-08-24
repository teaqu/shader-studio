#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image="${PLAYWRIGHT_LINUX_IMAGE:-mcr.microsoft.com/playwright:v1.60.0-noble}"
volume="shader-studio-linux-amd64-node-modules"

docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null

docker run --rm --platform linux/amd64 --ipc=host \
  -e CI=1 \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  -v "$repo_root:/work" \
  -v "$volume:/work/node_modules" \
  -w /work \
  "$image" \
  sh -lc 'npm ci && npm run test:e2e -w rendering'
