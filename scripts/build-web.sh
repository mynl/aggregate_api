#!/usr/bin/env bash
# Build the aggregate SPA into src/aggregate_api/static/.
#
# Usage:
#   ./scripts/build-web.sh                         # same-origin root build
#   ./scripts/build-web.sh https://api.mynl.com    # split-origin api build
#   ./scripts/build-web.sh /Q7M4Z9KP               # hidden subpath build
#
# The optional first argument becomes VITE_API_BASE_URL for Vite. The frontend
# code reads that value in web/src/config.js and prepends it to every fetch()
# wrapper in web/src/api.js.
#
# Examples:
#   no argument      -> fetch('/v1/health')
#   /Q7M4Z9KP       -> fetch('/Q7M4Z9KP/v1/health')
#   https://api...  -> fetch('https://api.../v1/health')
#
# This matters for a Caddy `handle_path /Q7M4Z9KP/*` deployment: the browser
# must request /Q7M4Z9KP/v1/... so Caddy can match the hidden prefix, strip it,
# and proxy /v1/... to FastAPI.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
web_dir="$script_dir/../web"

api_base="${1:-}"

cd "$web_dir"

if [[ -n "$api_base" ]]; then
    # Vite exposes env vars beginning with VITE_ to the browser bundle at build
    # time. This value is baked into the generated static JS until the next
    # build, so changing the Caddy prefix requires rebuilding the SPA.
    export VITE_API_BASE_URL="$api_base"
    echo "Building with VITE_API_BASE_URL=$api_base"
fi

if [[ ! -d node_modules ]]; then
    echo "Installing npm dependencies..."
    npm install --no-fund --no-audit
fi

echo "Running vite build..."
npm run build
