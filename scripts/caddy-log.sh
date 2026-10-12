#!/usr/bin/env bash
# Watch or query Caddy's access log, which lives in the journal.
#
# Caddy's `log` directive defaults to stderr, so under systemd the access lines
# land in journald beside Caddy's own messages. That mixes JSON access entries
# with the plain-text startup lines Caddy prints (`runtime.GOOS=linux` and
# friends), which is why every query here reads lines as raw strings and parses
# with `fromjson?`: the `?` yields nothing on a line that is not JSON instead of
# aborting the whole pipe, which is what a bare `jq` does on the first one.
#
# Intended to run on the Linux host, not on Windows.
#
# Usage:
#   bash scripts/caddy-log.sh              # follow the access log live (the default)
#   bash scripts/caddy-log.sh 429          # every rate-limited request today
#   bash scripts/caddy-log.sh errors       # today's non-2xx, newest last
#   bash scripts/caddy-log.sh recent 200   # the last 200 access lines, no follow
#   bash scripts/caddy-log.sh raw          # follow everything, unparsed
#
# Environment overrides:
#   CADDY_SERVICE=caddy
#   SINCE='today'            # any journalctl --since expression

set -uo pipefail

service="${CADDY_SERVICE:-caddy}"
since="${SINCE:-today}"

# journalctl needs root, so take it here rather than making the caller remember.
if [[ "$(id -u)" -eq 0 ]]; then
    sudo=""
else
    sudo="sudo"
fi

have_jq=1
command -v jq >/dev/null 2>&1 || have_jq=0

# One row per request: status, method, path, client. The fields Caddy always
# sets, so nothing here is conditional on a particular format version.
access='fromjson? | select(.msg=="handled request")
        | [.status, .request.method, .request.uri, .request.client_ip] | @tsv'

# Same, with a readable timestamp. Caddy writes `ts` as a fractional epoch and
# `todate` wants a whole number, hence the floor.
stamped='fromjson? | select(.msg=="handled request")
         | [(.ts|floor|todate), .status, .request.method, .request.uri, .request.client_ip] | @tsv'

mode="${1:-follow}"

case "$mode" in
follow)
    if [[ "$have_jq" -eq 0 ]]; then
        echo "jq not installed (sudo apt install jq); showing raw lines." >&2
        exec $sudo journalctl -u "$service" -f --output=cat
    fi
    echo "following $service access log. Ctrl+C to stop." >&2
    $sudo journalctl -u "$service" -f --output=cat | jq -rR "$access"
    ;;

429)
    if [[ "$have_jq" -eq 0 ]]; then
        # Crude against JSON, but the key is unambiguous in an access line.
        $sudo journalctl -u "$service" --since "$since" --output=cat | grep '"status":429'
        exit 0
    fi
    echo "rate-limited requests since $since:" >&2
    $sudo journalctl -u "$service" --since "$since" --output=cat \
        | jq -rR 'fromjson? | select(.status==429)
                  | [(.ts|floor|todate), .request.client_ip, .request.uri] | @tsv'
    ;;

errors)
    if [[ "$have_jq" -eq 0 ]]; then
        echo "jq required for this mode (sudo apt install jq)." >&2
        exit 1
    fi
    echo "non-2xx responses since $since:" >&2
    $sudo journalctl -u "$service" --since "$since" --output=cat \
        | jq -rR 'fromjson? | select(.msg=="handled request") | select(.status >= 300)
                  | [(.ts|floor|todate), .status, .request.method, .request.uri, .request.client_ip] | @tsv'
    ;;

recent)
    lines="${2:-100}"
    if [[ "$have_jq" -eq 0 ]]; then
        exec $sudo journalctl -u "$service" -n "$lines" --output=cat
    fi
    $sudo journalctl -u "$service" -n "$lines" --output=cat | jq -rR "$stamped"
    ;;

raw)
    exec $sudo journalctl -u "$service" -f --output=cat
    ;;

*)
    cat >&2 <<EOF
usage: $0 [follow|429|errors|recent N|raw]

  follow      (default) one row per request, live
  429         rate-limited requests since \$SINCE (default: today)
  errors      non-2xx since \$SINCE
  recent N    the last N access lines, no follow
  raw         everything journald has for $service, unparsed
EOF
    exit 2
    ;;
esac
