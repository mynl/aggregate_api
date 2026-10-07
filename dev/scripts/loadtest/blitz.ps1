<#
.SYNOPSIS
    Fire N simultaneous landing builds at a local api and report what the cache did.

.DESCRIPTION
    Reproduces the shape of the 2026-10-16 demonstration from one machine, with no
    Caddy in the path: fifty browser tabs opening the app at the same moment, each
    one posting the landing program because `loadLanding` in web/src/main.js builds
    on page load.

    The question it answers is not "how fast is the server". It is "how many times
    does the server build the same object", and the answer is in the Builds line of
    the summary. One is the behavior to aim at. N means every caller missed the
    cache and queued, which is what the one-slot build semaphore plus the absence
    of in-flight deduplication produces today. See dev/plan-demo-load.md.

    Two details make the measurement honest and are easy to get wrong.

    **A shared start barrier.** Creating fifty PowerShell runspaces takes a second
    or more and they do not become ready together, so workers that sent on creation
    would smear their arrivals across the very window under test. Each worker
    instead waits for one wall-clock instant, `-WarmupSeconds` from launch, and
    sends then.

    **A client timeout well past the server's.** The server abandons a build at
    AGGAPI_BUILD_TIMEOUT_S (10 s by default) and returns 504, and with builds
    serialized the last of fifty can legitimately wait a minute. A short client
    timeout would report a client-side abort as though it were server behavior, so
    the default here is deliberately generous.

    Request bodies match what the SPA sends: `{"decl": "..."}` and nothing else
    (web/src/api.js:89, called as `api.build(decl, {})`), so this blitz lands on
    the same shared cache entry the real landing page uses.

.PARAMETER BaseUrl
    Where the api is. Default is the local run from human-hints.md.

.PARAMETER Count
    How many simultaneous callers. Fifty is the demonstration's room size.

.PARAMETER Program
    The DecL to build. Defaults to LANDING_DECL from web/src/main.js, verbatim,
    because the landing build is the request every visitor makes without asking.

.PARAMETER SharedSession
    Send one session id for every caller instead of one each. Off by default,
    since fifty tabs are fifty sessions. Turn it on to see the per-session rate
    limit bite once a limiter is keyed that way.

.PARAMETER Cold
    Learn the object id with one sequential build, delete it, then blitz. This is
    how to get a cold cache without restarting the server, which would also drop
    every session fork and the library.

.PARAMETER Follow
    After the build, do what a visitor's browser then does: fetch the summary and
    the first available exhibit. Exercises the exhibit cache alongside the object
    cache.

.PARAMETER TimeoutSec
    Per-request client timeout. See above on why it is large.

.EXAMPLE
    .\blitz.ps1
    Fifty simultaneous landing builds against a warm or cold local server.

.EXAMPLE
    .\blitz.ps1 -Cold -Follow
    The cold path, with the follow-up reads a real visitor makes. This is the run
    that shows the problem.

.EXAMPLE
    .\blitz.ps1; .\blitz.ps1
    Cold then warm, back to back. The difference between the two Builds lines is
    the whole finding.

.NOTES
    Needs PowerShell 7 for ForEach-Object -Parallel and -SkipHttpErrorCheck.
    Watch http://127.0.0.1:8001/v1/status/page in a browser while this runs; the
    status gate admits loopback, so the page works locally with no VPN.
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:8001',
    [int]    $Count = 50,
    [string] $Program = "agg BasicBook`n  250 claims`n  1000 xs 0`n  sev lognorm 100 cv 1.5`n  poisson`n",
    [switch] $SharedSession,
    [switch] $Cold,
    [switch] $Follow,
    [int]    $TimeoutSec = 120,
    [double] $WarmupSeconds = 3.0
)

$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw "Needs PowerShell 7 (found $($PSVersionTable.PSVersion)). Run under pwsh."
}

# Build the body once. ConvertTo-Json does the escaping, which matters because the
# program is multi-line.
$body = @{ decl = $Program } | ConvertTo-Json -Compress
$runId = (Get-Date -Format 'HHmmss')

function Get-StatusSnapshot {
    <#
      The operator's view, or $null when it is not reachable. Not fatal: the gate
      404s for a caller outside AGGAPI_PRIVATE_CIDRS, and the blitz is still
      worth running without it.
    #>
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/v1/status" -SkipHttpErrorCheck -TimeoutSec 10
        if ($r.StatusCode -ne 200) { return $null }
        return $r.Content | ConvertFrom-Json
    } catch { return $null }
}

Write-Host ''
Write-Host "blitz: $Count simultaneous callers -> $BaseUrl" -ForegroundColor Cyan
Write-Host "program: $($Program.Split("`n")[0]) ..." -ForegroundColor DarkGray

# ----------------------------------------------------------------------
# Cold start, without restarting the server
# ----------------------------------------------------------------------
if ($Cold) {
    Write-Host 'cold: learning the object id with one sequential build' -ForegroundColor DarkGray
    $probe = Invoke-WebRequest -Uri "$BaseUrl/v1/objects" -Method POST -Body $body `
        -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec $TimeoutSec
    if ($probe.StatusCode -ne 200) {
        throw "cold probe failed with HTTP $($probe.StatusCode): $($probe.Content)"
    }
    $probeId = ($probe.Content | ConvertFrom-Json).id
    $del = Invoke-WebRequest -Uri "$BaseUrl/v1/objects/$probeId" -Method DELETE `
        -SkipHttpErrorCheck -TimeoutSec 30
    Write-Host "cold: dropped $probeId (HTTP $($del.StatusCode))" -ForegroundColor DarkGray
}

$before = Get-StatusSnapshot

# ----------------------------------------------------------------------
# The blitz
# ----------------------------------------------------------------------
# Every worker waits for this instant, so runspace creation is outside the window.
$startAt = (Get-Date).AddSeconds($WarmupSeconds)
Write-Host "firing at $($startAt.ToString('HH:mm:ss.fff'))" -ForegroundColor DarkGray

$wall = [System.Diagnostics.Stopwatch]::StartNew()

$results = 1..$Count | ForEach-Object -ThrottleLimit $Count -Parallel {
    $i = $_
    $base = $using:BaseUrl
    $body = $using:body
    $timeout = $using:TimeoutSec
    $follow = $using:Follow
    $runId = $using:runId

    $session = if ($using:SharedSession) { "blitz-$runId-shared" } else { "blitz-$runId-$i" }
    $headers = @{ 'X-Aggregate-Session' = $session }

    # Hold until the shared instant. Sleeping the remainder is accurate to a few
    # milliseconds, which is far finer than the thing being measured.
    $remaining = ($using:startAt - (Get-Date)).TotalMilliseconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $row = [ordered]@{
        worker = $i; status = 0; ms = 0; id = $null; cached = $null
        serverMs = $null; kind = $null; followStatus = $null; followMs = $null
        error = $null
    }
    try {
        $r = Invoke-WebRequest -Uri "$base/v1/objects" -Method POST -Body $body `
            -ContentType 'application/json' -Headers $headers `
            -SkipHttpErrorCheck -TimeoutSec $timeout
        $row.status = [int] $r.StatusCode
        $row.ms = [int] $sw.ElapsedMilliseconds
        if ($row.status -eq 200) {
            $j = $r.Content | ConvertFrom-Json
            $row.id = $j.id
            $row.cached = [bool] $j.cached
            $row.serverMs = $j.elapsed_ms
            $row.kind = $j.kind
        } else {
            # Keep the head of the body: a 422 carries the parse report and a 504
            # carries "build timeout", and both are the point of the run.
            $row.error = ($r.Content -replace '\s+', ' ')
            if ($row.error.Length -gt 160) { $row.error = $row.error.Substring(0, 160) }
        }
    } catch {
        $row.ms = [int] $sw.ElapsedMilliseconds
        $row.error = $_.Exception.Message
    }

    # What the browser does next: the summary, then the first exhibit the object
    # says it has. Both are GETs and neither is rate limited, but both are compute
    # on a miss, which is what the exhibit cache is for.
    if ($follow -and $row.id) {
        $fsw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $s = Invoke-WebRequest -Uri "$base/v1/objects/$($row.id)/summary" `
                -Headers $headers -SkipHttpErrorCheck -TimeoutSec $timeout
            $ex = Invoke-WebRequest -Uri "$base/v1/objects/$($row.id)/exhibits" `
                -Headers $headers -SkipHttpErrorCheck -TimeoutSec $timeout
            $worst = [int] $s.StatusCode
            if ($ex.StatusCode -eq 200) {
                $names = ($ex.Content | ConvertFrom-Json).exhibits
                if ($names) {
                    $name = @($names)[0]
                    if ($name -is [string]) { $first = $name } else { $first = $name.name }
                    $e = Invoke-WebRequest -Uri "$base/v1/objects/$($row.id)/exhibit/$first" `
                        -Headers $headers -SkipHttpErrorCheck -TimeoutSec $timeout
                    $worst = [Math]::Max($worst, [int] $e.StatusCode)
                }
            }
            $row.followStatus = $worst
        } catch {
            $row.followStatus = -1
        }
        $row.followMs = [int] $fsw.ElapsedMilliseconds
    }

    [pscustomobject] $row
}

$wall.Stop()
$after = Get-StatusSnapshot

# ----------------------------------------------------------------------
# What happened
# ----------------------------------------------------------------------
$ok = @($results | Where-Object { $_.status -eq 200 })
$builds = @($ok | Where-Object { -not $_.cached })
$hits = @($ok | Where-Object { $_.cached })
$ids = @($results.id | Where-Object { $_ } | Sort-Object -Unique)
$times = @($results.ms | Sort-Object)

function Pct([int] $p) {
    if ($times.Count -eq 0) { return 0 }
    return $times[[int][Math]::Floor(($p / 100.0) * ($times.Count - 1))]
}

$results | Sort-Object worker | Format-Table -AutoSize `
    worker, status, ms, cached, serverMs, followStatus, followMs, error

Write-Host ''
Write-Host '--- summary ---' -ForegroundColor Cyan
Write-Host ("callers        : {0}" -f $Count)
Write-Host ("wall clock     : {0} ms" -f $wall.ElapsedMilliseconds)
Write-Host ("Builds         : {0}   <- one is the goal; {1} means nobody shared" -f $builds.Count, $Count) `
    -ForegroundColor $(if ($builds.Count -le 1) { 'Green' } elseif ($builds.Count -ge ($Count / 2)) { 'Red' } else { 'Yellow' })
Write-Host ("cache hits     : {0}" -f $hits.Count)
Write-Host ("distinct ids   : {0}   <- more than one means the room is not sharing a cache entry" -f $ids.Count) `
    -ForegroundColor $(if ($ids.Count -le 1) { 'Green' } else { 'Red' })
Write-Host ("latency ms     : min {0}  p50 {1}  p95 {2}  max {3}" -f $times[0], (Pct 50), (Pct 95), $times[-1])

Write-Host 'status codes   :'
$results | Group-Object status | Sort-Object Name | ForEach-Object {
    $flag = if ($_.Name -eq '200') { 'Green' } else { 'Red' }
    Write-Host ("                 HTTP {0}  x{1}" -f $_.Name, $_.Count) -ForegroundColor $flag
}
if ($Follow) {
    $fbad = @($results | Where-Object { $_.followStatus -and $_.followStatus -ge 400 })
    Write-Host ("follow-up      : {0} of {1} failed" -f $fbad.Count, $ok.Count) `
        -ForegroundColor $(if ($fbad.Count -eq 0) { 'Green' } else { 'Red' })
}

if ($before -and $after) {
    Write-Host ''
    Write-Host '--- /v1/status, before and after ---' -ForegroundColor Cyan
    Write-Host ("builds.live    : {0}" -f ($after.builds.live | ConvertTo-Json -Compress))
    Write-Host ("key_scope      : {0}" -f ($after.key_scope | ConvertTo-Json -Compress))
    Write-Host ("object cache   : {0} -> {1} entries" -f $before.cache.entries, $after.cache.entries)
    Write-Host ("exhibit cache  : {0}" -f ($after.exhibit_cache | ConvertTo-Json -Compress))
    Write-Host ("chart cache    : {0}" -f ($after.chart_cache | ConvertTo-Json -Compress))
} else {
    Write-Host ''
    Write-Host '/v1/status not reachable; open /v1/status/page in a browser instead.' -ForegroundColor DarkGray
}
Write-Host ''
