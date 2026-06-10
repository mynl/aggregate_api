# Serving `aggregate_api` Behind Caddy

Goal: serve the existing FastAPI + SPA app from the Linux box through Caddy,
under an obscure path on `www.mynl.com`, with body-size and per-IP rate limits.

Chosen path token:

```text
Q7M4Z9KP
```

Public URL:

```text
https://www.mynl.com/Q7M4Z9KP/
```

This is only obscurity, not authentication. Anyone who gets the URL can use the
app within the configured limits. For a stronger gate, add Caddy `basic_auth`
or an application-level login later.

## Design

- Caddy terminates HTTPS on `www.mynl.com`.
- `aggregate-api` listens only on loopback, e.g. `127.0.0.1:8001`.
- Caddy handles only `/Q7M4Z9KP/*` for this app and returns 404 elsewhere if
  this host is dedicated to the demo.
- `handle_path /Q7M4Z9KP/*` strips the prefix before proxying, so the backend
  still receives `/`, `/v1/health`, `/v1/objects`, etc.
- The SPA must be rebuilt with `VITE_API_BASE_URL=/Q7M4Z9KP`, otherwise browser
  API calls go to `/v1/...` at the domain root and will 404.
- `X-Robots-Tag` and `robots.txt` discourage indexing. They do not stop bots
  that ignore robots rules.

References checked:

- `github.com/mholt/caddy-ratelimit` documents `xcaddy build --with github.com/mholt/caddy-ratelimit`, the `rate_limit` Caddyfile directive, sliding-window limits, `events`, `window`, and `ipv6_prefix`.
- Caddy's `request_body` directive supports `max_size` and returns HTTP 413 when exceeded.
- Caddy's `handle_path` strips the matched path prefix before running inner handlers.

## Caddyfile

If `www.mynl.com` is dedicated to this demo, this whole site block is suitable:

```caddyfile
www.mynl.com {
    handle /robots.txt {
        header Content-Type text/plain
        respond "User-agent: *\nDisallow: /\n" 200
    }

    redir /Q7M4Z9KP /Q7M4Z9KP/ 308

    handle_path /Q7M4Z9KP/* {
        route {
            header {
                X-Robots-Tag "noindex, nofollow, noarchive, nosnippet, noimageindex"
                Referrer-Policy "no-referrer"
            }

            request_body {
                max_size 1MB
            }

            rate_limit {
                zone aggregate_demo_minute_by_ip {
                    key         {remote_host}
                    events      5
                    window      1m
                    ipv6_prefix 64
                }

                zone aggregate_demo_hour_by_ip {
                    key         {remote_host}
                    events      50
                    window      1h
                    ipv6_prefix 64
                }

                log_key
            }

            reverse_proxy 127.0.0.1:8001
        }
    }

    respond 404
}
```

If `www.mynl.com` already serves another site, do not use the final
`respond 404`. Merge the `robots.txt`, `redir`, and `handle_path` blocks into
the existing `www.mynl.com` site block before the normal site handlers.

## One-Time Server Setup

Run these on the Linux VPS.

Install Go if it is not already available:

```bash
sudo apt update
sudo apt install -y golang-go
```

Build the frontend bundle with the secret path as the API prefix:

```bash
cd ~/hacking/aggregate_api
bash ./scripts/build-web.sh /Q7M4Z9KP
```

Run the backend on loopback:

```bash
cd ~/hacking/aggregate_api
uv run aggregate-api --host 127.0.0.1 --port 8001
```

For the current `nohup` setup:

```bash
cd ~/hacking/aggregate_api
nohup uv run aggregate-api --host 127.0.0.1 --port 8001 > ~/aggapi.log 2>&1 &
```

Edit `/etc/caddy/Caddyfile` and add or merge the Caddyfile block above.

Build and install Caddy with the rate-limit module:

```bash
cd ~/hacking/aggregate_api
bash ./scripts/setup-caddy-ratelimit.sh
```

The script:

- installs `xcaddy` with `go install` if needed;
- builds Caddy with `github.com/mholt/caddy-ratelimit`;
- validates that `http.handlers.rate_limit` is present;
- validates `/etc/caddy/Caddyfile` with the newly built binary;
- backs up the existing Caddy binary;
- stops the `caddy` systemd service;
- installs the custom binary;
- starts the service;
- smoke-tests `https://www.mynl.com/Q7M4Z9KP/v1/health`.

Useful overrides:

```bash
CADDYFILE=/path/to/Caddyfile bash ./scripts/setup-caddy-ratelimit.sh
CADDY_BIN=/usr/bin/caddy bash ./scripts/setup-caddy-ratelimit.sh
SMOKE_URL=https://www.mynl.com/Q7M4Z9KP/v1/health bash ./scripts/setup-caddy-ratelimit.sh
RUN_RATE_LIMIT_TEST=1 bash ./scripts/setup-caddy-ratelimit.sh
```

`RUN_RATE_LIMIT_TEST=1` intentionally sends enough requests to trigger HTTP 429.
That consumes the minute bucket for your current IP, so use it only when you are
ready to wait a minute afterward.

## Validation

Check that Caddy has the module:

```bash
caddy list-modules | grep rate_limit
```

Validate the Caddyfile:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Check the backend directly on the VPS:

```bash
curl -i http://127.0.0.1:8001/v1/health
```

Check Caddy through the public route:

```bash
curl -i https://www.mynl.com/Q7M4Z9KP/v1/health
```

Check that the unhidden route does not expose the API:

```bash
curl -i https://www.mynl.com/v1/health
```

Expected: HTTP 404.

Check the body-size limit:

```bash
python3 - <<'PY' | curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST --data-binary @- https://www.mynl.com/Q7M4Z9KP/v1/objects
print("x" * 1100000)
PY
```

Expected: HTTP 413.

Check the minute rate limit:

```bash
for i in 1 2 3 4 5 6 7; do
  curl -sS -o /dev/null -w "request $i -> %{http_code}\n" \
    https://www.mynl.com/Q7M4Z9KP/v1/health
done
```

Expected: the first five requests should be allowed, then at least one request
should return HTTP 429. If you already used the app from the same IP in the last
minute, the 429 may arrive earlier.

Check indexing headers:

```bash
curl -I https://www.mynl.com/Q7M4Z9KP/
curl -i https://www.mynl.com/robots.txt
```

## Refresh Script Change

Wherever the VPS refresh script currently rebuilds the SPA as:

```bash
bash ./scripts/build-web.sh
```

change it to:

```bash
bash ./scripts/build-web.sh /Q7M4Z9KP
```

This keeps the browser API calls behind the same obscure prefix.

## Operational Notes

- Package-manager Caddy upgrades can overwrite the custom binary. After any
  `apt upgrade`, run `caddy list-modules | grep rate_limit`; rerun
  `scripts/setup-caddy-ratelimit.sh` if the module is gone.
- Keep `aggregate-api` bound to `127.0.0.1`, not `0.0.0.0`, when serving through
  public Caddy.
- The app still has no auth and can run expensive model builds. The current
  Caddy limits reduce accidental or casual abuse, but the backend's `log2_cap`,
  semaphore, and build timeout remain the important compute safeguards.
- If Swagger UI matters under the hidden path, test it separately. The SPA and
  `/v1/*` API routes work with this prefix setup; generated docs can need extra
  FastAPI `root_path` handling under subpath proxies.
