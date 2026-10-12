## The room script

dev/scripts/loadtest/room.ps1. Fifty people, each with their own session id in the SPA's format, all opening the page on one synchronized instant, then working through examples with randomized think time. Each person does the page load (meta, examples), the landing build that happens whether they ask or not, then for each example: build, summary, exhibits, first exhibit, and a density read in the shape the SPA actually sends. It reports per-step latency and labels the codes by meaning, so 429 (Caddy refused), 503 (object busy), 504 (build timed out) and 502 (the app stopped answering) are not lumped together. It sends User-Agent: aggregate-api-roomtest so this traffic is identifiable in your logs afterwards.

```powershell
cd dev\scripts\loadtest
.\room.ps1 -People 5 -Examples 3                                   # smoke first
.\room.ps1 -StatusUrl http://10.8.0.1:19456/v1/status              # the real thing
.\room.ps1 -ExampleNames 'BasicBook,PropertyCasualty,TwoLineBook' -PerPerson 3
```

Pass `-StatusUrl` with the VPN address to get the server's own counters before and after, since the public route 404s /v1/status by design.

I have not run it against your public site, because that is outward-facing traffic on a live host and 50 people at 3 builds each is about 150 builds. Say go and I will run the 5-person smoke first and then the full 50, or run it yourself with the VPN status URL so you see the server side too.

```powershell
[10:01:22] V:\dev\aggregate-api\dev\scripts\loadtest> .\room.ps1 -StatusUrl http://10.8.0.1:19456/v1/status

room: 50 people, 2 examples each -> https://agg.mynl.com
deployed: aggregate_api 1.0.0, aggregate 1.0.1
examples: BasicBook[agg], Capstone.GrossNet[bvagg], CCoCDistortion[distortion], RetroRatedAccount[pnl], LayerPicks.Compare[port], Capstone.Sev[sev], Capstone.XOL.PnL[xpnl], DiceOneDie[agg]
everyone opens the page at 10:02:08.465

--- by step ---
step             calls      ok   p50 ms   p95 ms other codes
meta                50      50      313      344
examples            50      50      601      864
landing-build       50      50      739      890
example-build      100     100      428     1394
summary            100      88      260      428 400x12
exhibits           100     100      263      342
exhibit             88      88      269      433
density            100     100      466      845

--- totals ---
people           : 50
requests         : 638
wall clock       : 26.2 s
latency overall  : p50 325 ms   p95 849 ms   max 2168 ms
status codes     :
                   HTTP 200   x626   ok
                   HTTP 400   x12

health after     : HTTP 200 in 256 ms

--- server side, before -> after ---
builds started   : 234 -> 240
build timeouts   : 0 -> 0
object cache     : 50 -> 50 of 50 entries
cache hit rate   : 0.8984
exhibit cache    : {"entries":37,"max":64,"hits":154,"misses":37,"hit_rate":0.8063,"evictions":0}
chart cache      : {"entries":8,"max":8,"hits":100,"misses":234,"hit_rate":0.2994,"evictions":226}
live sessions    : 50 -> 100 of 500
key scope        : shared 490, session 22
process RSS      : 3,017 MB


[Elapsed: 00m 27s 438ms]
```