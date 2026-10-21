#!/bin/sh
set -eu
cd /app
if [ -f /app/bin/tuneweave ]; then
  chmod +x /app/bin/tuneweave
  export CATALOG_BIN=/app/bin/tuneweave
fi
export npm_config_cache=/data/npm-cache
fingerprint="$(sha256sum package-lock.json | cut -d ' ' -f1)"
installed="$(cat node_modules/.alger-lock-sha256 2>/dev/null || true)"
if [ "$fingerprint" != "$installed" ]; then
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  printf '%s\n' "$fingerprint" > node_modules/.alger-lock-sha256
fi
exec node nas/server.mjs
