#!/usr/bin/env bash
# Restart Caddy so that a bad edit cannot leave the box serving nothing.
#
# Why this exists. A Caddyfile that parses but will not *provision* takes down
# every site on the host, not just the one you edited, and
# `caddy validate` does not catch that class of fault: on 2026-10-07 an added
# `log` block whose directory was not writable passed validation and then failed
# at startup with `open /var/log/caddy/agg.log: permission denied`, stopping
# agg.mynl.com, www.mynl.com, convexrisk, salaryrank and blog together. The only
# reliable test is to restart and ask whether the service is still active.
#
# Intended to run on the Linux host, not on Windows.
#
# Usage, in this order:
#
#   sudo bash scripts/caddy-reload.sh save     # while the site is UP, before editing
#   $EDITOR /etc/caddy/Caddyfile
#   sudo bash scripts/caddy-reload.sh apply    # restart, auto-rollback on failure
#
# `save` snapshots the config that is currently serving. `apply` restarts and,
# if the service does not come back, puts the snapshot back and restarts again,
# so the worst case is the configuration you started from.
#
# Environment overrides:
#   CADDYFILE=/etc/caddy/Caddyfile
#   CADDY_SERVICE=caddy
#   SMOKE_URL=https://agg.mynl.com/v1/health

set -uo pipefail

caddyfile="${CADDYFILE:-/etc/caddy/Caddyfile}"
service="${CADDY_SERVICE:-caddy}"
smoke_url="${SMOKE_URL:-https://agg.mynl.com/v1/health}"
backup="${caddyfile}.last-good"

mode="${1:-}"

die() {
    echo "$*" >&2
    exit 1
}

case "$mode" in
save)
    if ! systemctl is-active --quiet "$service"; then
        die "refusing to save: $service is not active, so the current file is not known good."
    fi
    [[ -f "$caddyfile" ]] || die "no such file: $caddyfile"
    cp -p "$caddyfile" "$backup"
    echo "saved known-good config to $backup"
    ;;

apply)
    [[ -f "$caddyfile" ]] || die "no such file: $caddyfile"
    if [[ ! -f "$backup" ]]; then
        die "no $backup to roll back to. Run '$0 save' while the site is up, before editing."
    fi

    # Syntax first. Cheap, and it catches the typos; it does not catch
    # provisioning faults, which is the whole reason for the restart test below.
    if ! caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1; then
        echo "caddy validate FAILED, not restarting. The running config is untouched:" >&2
        caddy validate --config "$caddyfile" --adapter caddyfile || true
        exit 1
    fi

    echo "restarting $service..."
    systemctl restart "$service" || true
    sleep 2

    if systemctl is-active --quiet "$service"; then
        echo "$service is active."
        if curl -fsS --max-time 15 "$smoke_url" >/dev/null 2>&1; then
            echo "smoke test OK: $smoke_url"
            cp -p "$caddyfile" "$backup"
            echo "this config is now the known-good snapshot."
            exit 0
        fi
        # Active but not serving is still a failure worth rolling back from: a
        # site block can be broken without stopping the process.
        echo "WARNING: $service is active but $smoke_url did not answer." >&2
        echo "Rolling back to $backup." >&2
    else
        echo "$service failed to start. Rolling back to $backup." >&2
        journalctl -u "$service" -n 15 --no-pager >&2 || true
    fi

    cp -p "$backup" "$caddyfile"
    systemctl restart "$service" || true
    sleep 2
    if systemctl is-active --quiet "$service"; then
        echo "rolled back; $service is active again. Your edit is NOT applied." >&2
    else
        die "ROLLBACK ALSO FAILED. The box is serving nothing. Investigate now: journalctl -u $service -n 40"
    fi
    exit 1
    ;;

*)
    cat >&2 <<EOF
usage: $0 {save|apply}

  save    snapshot the running config to $backup (run while the site is UP)
  apply   restart with the current config, rolling back to the snapshot on failure
EOF
    exit 2
    ;;
esac
