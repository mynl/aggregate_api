#!/usr/bin/env bash
# Build and install Caddy with github.com/mholt/caddy-ratelimit, then validate
# and restart the systemd service.
#
# Intended to run on the Linux host, not on Windows.
#
# Environment overrides:
#   CADDY_BIN=/usr/bin/caddy
#   CADDYFILE=/etc/caddy/Caddyfile
#   CADDY_SERVICE=caddy
#   SMOKE_URL=https://www.mynl.com/Q7M4Z9KP/v1/health
#   RUN_RATE_LIMIT_TEST=1

set -euo pipefail

module="${CADDY_RATE_LIMIT_MODULE:-github.com/mholt/caddy-ratelimit}"
caddy_service="${CADDY_SERVICE:-caddy}"
caddyfile="${CADDYFILE:-/etc/caddy/Caddyfile}"
smoke_url="${SMOKE_URL:-https://www.mynl.com/Q7M4Z9KP/v1/health}"

if [[ -n "${CADDY_BIN:-}" ]]; then
    caddy_bin="$CADDY_BIN"
elif command -v caddy >/dev/null 2>&1; then
    caddy_bin="$(command -v caddy)"
elif [[ -x /usr/bin/caddy ]]; then
    caddy_bin="/usr/bin/caddy"
else
    echo "Could not find caddy. Set CADDY_BIN=/path/to/caddy." >&2
    exit 1
fi

need_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing command: $1" >&2
        return 1
    fi
}

need_cmd sudo
need_cmd systemctl
need_cmd curl
need_cmd grep
need_cmd go

if ! command -v xcaddy >/dev/null 2>&1; then
    echo "Installing xcaddy into GOPATH/bin..."
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
    export PATH="$(go env GOPATH)/bin:$PATH"
fi

need_cmd xcaddy

if [[ ! -f "$caddyfile" ]]; then
    echo "Caddyfile not found: $caddyfile" >&2
    exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() {
    rm -rf "$tmpdir"
}
trap cleanup EXIT

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="${caddy_bin}.backup.${timestamp}"

restore_backup_and_exit() {
    echo "Restoring previous Caddy binary from $backup..." >&2
    sudo install -o root -g root -m 0755 "$backup" "$caddy_bin"
    if command -v setcap >/dev/null 2>&1; then
        sudo setcap cap_net_bind_service=+ep "$caddy_bin" || true
    fi
    sudo systemctl start "$caddy_service" || true
    exit 1
}

echo "Building Caddy with $module..."
(
    cd "$tmpdir"
    xcaddy build --with "$module"
    ./caddy list-modules | grep -q '^http.handlers.rate_limit$'
    ./caddy validate --config "$caddyfile" --adapter caddyfile
)

echo "Backing up $caddy_bin to $backup..."
sudo cp "$caddy_bin" "$backup"

echo "Stopping $caddy_service..."
sudo systemctl stop "$caddy_service"

echo "Installing custom Caddy to $caddy_bin..."
sudo install -o root -g root -m 0755 "$tmpdir/caddy" "$caddy_bin"

if command -v setcap >/dev/null 2>&1; then
    sudo setcap cap_net_bind_service=+ep "$caddy_bin" || true
fi

echo "Validating installed Caddy and Caddyfile..."
"$caddy_bin" list-modules | grep -q '^http.handlers.rate_limit$'
if ! sudo "$caddy_bin" validate --config "$caddyfile" --adapter caddyfile; then
    restore_backup_and_exit
fi

echo "Starting $caddy_service..."
if ! sudo systemctl start "$caddy_service"; then
    restore_backup_and_exit
fi
if ! sudo systemctl is-active --quiet "$caddy_service"; then
    restore_backup_and_exit
fi

echo "Smoke testing $smoke_url..."
curl -fsS "$smoke_url" >/tmp/aggregate-api-health.json
cat /tmp/aggregate-api-health.json
echo

if [[ "${RUN_RATE_LIMIT_TEST:-0}" == "1" ]]; then
    echo "Running minute rate-limit probe against $smoke_url..."
    saw_429=0
    for i in 1 2 3 4 5 6 7; do
        code="$(curl -sS -o /dev/null -w '%{http_code}' "$smoke_url")"
        echo "request $i -> HTTP $code"
        if [[ "$code" == "429" ]]; then
            saw_429=1
        fi
    done
    if [[ "$saw_429" != "1" ]]; then
        echo "Warning: did not see HTTP 429 in the rate-limit probe." >&2
    fi
fi

echo "Done. Previous Caddy binary is at $backup"
