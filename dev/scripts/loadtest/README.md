# Load tests

PowerShell 7 scripts that drive a running `aggregate-api` the way the SPA does.

| Script | What it simulates |
|---|---|
| `room.ps1` | A led room: fifty people open the page on one instant, then work through a few examples with think time. The demonstration shape. |
| `blitz.ps1` | N simultaneous landing builds at a local api, no Caddy in the path. Answers how many times the server builds the same object; one is the target. |
| `repro-lock-orphan.ps1` | Proves that one abandoned read orphans a cache-entry lock, the bug a201 and a202 fixed. Kept as a regression check. |

## room.ps1

It sends `User-Agent: aggregate-api-roomtest`, so its traffic can be picked out of the Caddy log afterwards. Each simulated person carries their own `X-Aggregate-Session` in the SPA's format and does:

1. the page load, `GET /v1/meta` and `GET /v1/examples`;
2. the landing build, which every page load makes without being asked;
3. per example: build, summary, exhibit list, first exhibit, and a density read in the shape the SPA sends.

It reports latency per step and labels the status codes by meaning, since they call for different fixes: 429 is the Caddy limiter (a room behind one NAT address shares a budget), 503 is a busy object shedding a read, 504 is a build timing out in the queue, and 502 means the app stopped answering. A 429 is recorded and never retried, because the SPA does not retry either.

```powershell
cd dev\scripts\loadtest
.\room.ps1 -People 5 -Examples 3                                        # smoke test, run first
.\room.ps1 -StatusUrl http://10.8.0.1:19456/v1/status                   # the full room
.\room.ps1 -ExampleNames 'BasicBook,PropertyCasualty,TwoLineBook' -PerPerson 3   # rehearse a running order
```

`-BaseUrl` defaults to the public site, so the Caddy limiter is in the path, which is the point. `-StatusUrl` reads the server's own counters before and after; the public route 404s `/v1/status` by design, so pass the VPN address.

The default run is fifty people and about 150 builds against a live host, so run it deliberately.

## Results

**Against the deployed 1.0.0 (aggregate 1.0.1), shortly after its 2026-10-07 release**: 50 people, 2 examples each, eight examples spread across the kinds, VPN status URL.

| Step | Calls | OK | p50 ms | p95 ms |
|---|---:|---:|---:|---:|
| meta | 50 | 50 | 313 | 344 |
| examples | 50 | 50 | 601 | 864 |
| landing build | 50 | 50 | 739 | 890 |
| example build | 100 | 100 | 428 | 1,394 |
| summary | 100 | 88 | 260 | 428 |
| exhibits | 100 | 100 | 263 | 342 |
| exhibit | 88 | 88 | 269 | 433 |
| density | 100 | 100 | 466 | 845 |

638 requests in 26.2 s, overall p50 325 ms, p95 849 ms, max 2,168 ms. No 429, 503, 504 or 502, and the site answered health in 256 ms afterwards. Server side: 6 builds started for the 150 asked for (the shared cache key paid), no build timeouts, object cache full at 50 of 50, process RSS 3,017 MB.

The 12 summary failures are HTTP 400, the summary route's "not available for this object" answer: the script asks every example for a summary, and one of the eight examples (12 of 100 picks) is of a kind that does not offer it. Not a server fault.
