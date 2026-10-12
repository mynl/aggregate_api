<#
.SYNOPSIS
    Simulate a room of people driving the live site through a handful of examples.

.DESCRIPTION
    The demonstration shape, against a deployed server rather than localhost: a
    led room of roughly fifty people who all open the page at the same moment
    and then run the same small set of library examples, with very little
    free-form typing.

    What each simulated person does, in order:

      1. page load: `GET /v1/meta` and `GET /v1/examples`, as the SPA does;
      2. the landing build, because `loadLanding` in web/src/main.js posts
         `BasicBook` on every page load with no user action;
      3. then, `-PerPerson` times: pick an example, build it, and read it the way
         a reader does, with the request shapes the SPA actually sends.

    Arrivals are synchronized on one wall-clock instant, which is what "everyone
    open this URL" produces, and everything after the page load is separated by
    randomized think time, which is what people produce. Both halves matter: a
    fully synchronized run overstates contention and a fully randomized one
    hides it.

    Every person carries a distinct `X-Aggregate-Session`, in the SPA's own
    `<utc timestamp>-<uuid4>` form, so a rate limiter keyed on that header is
    exercised the way a real room exercises it rather than collapsing into one
    bucket.

    **Codes worth watching, because they mean different things.**

      429  the Caddy build limiter refused. Per-IP budgets are shared by
           everyone behind one NAT address, so this is the one that fires in a
           conference room and not on your desk.
      503  the server refused a read of a busy object (`AGGAPI_ENTRY_LOCK_TIMEOUT_S`).
           Shedding load rather than dying; see dev/plan-demo-load.md item 0.
      504  a build exceeded `AGGAPI_BUILD_TIMEOUT_S`, abandoned in the queue.
      502  nothing of ours. A proxy could not reach the backend, which on this
           stack means the app stopped answering.

.PARAMETER BaseUrl
    The deployed site. Defaults to the public route, so the Caddy limiter is in
    the path, which is the point.

.PARAMETER People
    Simulated people. Fifty is the demonstration's room size.

.PARAMETER Examples
    How many distinct library examples the room uses between them. A led room
    uses few, which is what makes the shared cache key pay.

.PARAMETER PerPerson
    How many examples each person runs after the landing build.

.PARAMETER ExampleNames
    Explicit example names, comma separated, instead of picking by weight. Use
    this to rehearse the exact running order you plan to present.

.PARAMETER StatusUrl
    Optional `/v1/status` URL for the server-side view before and after. The
    public route 404s this prefix by design, so pass the VPN address, e.g.
    `http://10.8.0.1:19456/v1/status`.

.PARAMETER ThinkMinMs / ThinkMaxMs
    Think time between a person's actions.

.EXAMPLE
    .\room.ps1 -People 5 -Examples 3
    A smoke test. Run this first; it proves the script and the site agree.

.EXAMPLE
    .\room.ps1 -StatusUrl http://10.8.0.1:19456/v1/status
    Fifty people over eight examples, with the server's own counters read over
    the VPN before and after.

.EXAMPLE
    .\room.ps1 -ExampleNames 'BasicBook,PropertyCasualty,TwoLineBook' -PerPerson 3
    The rehearsal: exactly the programs you intend to show.

.NOTES
    Sends a `User-Agent` of `aggregate-api-roomtest`, so this traffic is
    identifiable in the Caddy log and not mistaken later for real visitors.

    Needs PowerShell 7 for `ForEach-Object -Parallel`.

    429s are recorded, never retried. A browser does not retry either: the SPA
    renders a card. Retrying would hide the budget this exists to measure.
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'https://agg.mynl.com',
    [int]    $People = 50,
    [int]    $Examples = 8,
    [int]    $PerPerson = 2,
    [string] $ExampleNames = '',
    [string] $StatusUrl = '',
    [int]    $ThinkMinMs = 500,
    [int]    $ThinkMaxMs = 3000,
    [double] $WarmupSeconds = 3.0,
    [int]    $TimeoutSec = 60
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Needs PowerShell 7.' }

$AGENT = 'aggregate-api-roomtest'
$BaseUrl = $BaseUrl.TrimEnd('/')

# The landing program, copied from web/src/main.js LANDING_DECL. Every page load
# builds this, so it is the one request the whole room makes without choosing to.
$LANDING = "agg BasicBook`n  250 claims`n  1000 xs 0`n  sev lognorm 100 cv 1.5`n  poisson`n"

Write-Host ''
Write-Host "room: $People people, $PerPerson examples each -> $BaseUrl" -ForegroundColor Cyan

# ----------------------------------------------------------------------
# What is deployed, and which examples it serves
# ----------------------------------------------------------------------
try {
    $meta = (Invoke-WebRequest "$BaseUrl/v1/health" -UserAgent $AGENT -TimeoutSec 20).Content | ConvertFrom-Json
    Write-Host "deployed: aggregate_api $($meta.version), aggregate $($meta.aggregate_version)" -ForegroundColor DarkGray
} catch {
    throw "cannot reach $BaseUrl/v1/health : $($_.Exception.Message)"
}

$allItems = ((Invoke-WebRequest "$BaseUrl/v1/examples" -UserAgent $AGENT -TimeoutSec 60).Content | ConvertFrom-Json).items
if (-not $allItems) { throw "no examples returned by $BaseUrl/v1/examples" }

if ($ExampleNames) {
    $wanted = $ExampleNames.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
    $chosen = @()
    foreach ($name in $wanted) {
        $hit = $allItems | Where-Object { $_.name -eq $name } | Select-Object -First 1
        if (-not $hit) { throw "no example named '$name' on $BaseUrl (check /v1/examples)" }
        $chosen += $hit
    }
} else {
    # A spread of kinds rather than the first N, so the run touches the
    # per-kind branches (a portfolio's exhibits are not an aggregate's).
    $byKind = $allItems | Group-Object kind
    $chosen = @()
    $round = 0
    while ($chosen.Count -lt $Examples -and $round -lt 20) {
        foreach ($g in $byKind) {
            if ($chosen.Count -ge $Examples) { break }
            $candidate = $g.Group | Select-Object -Skip $round -First 1
            if ($candidate) { $chosen += $candidate }
        }
        $round++
    }
}
Write-Host "examples: $(($chosen | ForEach-Object { "$($_.name)[$($_.kind)]" }) -join ', ')" -ForegroundColor DarkGray

function Get-Status {
    param([string] $Url)
    if (-not $Url) { return $null }
    try {
        $r = Invoke-WebRequest $Url -UserAgent $AGENT -SkipHttpErrorCheck -TimeoutSec 20
        if ($r.StatusCode -ne 200) { return $null }
        return $r.Content | ConvertFrom-Json
    } catch { return $null }
}

$before = Get-Status $StatusUrl
if ($StatusUrl -and -not $before) {
    Write-Host "status url unreachable; continuing without the server-side view" -ForegroundColor Yellow
}

# ----------------------------------------------------------------------
# The room
# ----------------------------------------------------------------------
$startAt = (Get-Date).AddSeconds($WarmupSeconds)
Write-Host "everyone opens the page at $($startAt.ToString('HH:mm:ss.fff'))" -ForegroundColor DarkGray

$wall = [System.Diagnostics.Stopwatch]::StartNew()

$rows = 1..$People | ForEach-Object -ThrottleLimit $People -Parallel {
    $person = $_
    $base = $using:BaseUrl
    $agent = $using:AGENT
    $timeout = $using:TimeoutSec
    $landing = $using:LANDING
    $pool = $using:chosen
    $perPerson = $using:PerPerson
    $thinkMin = $using:ThinkMinMs
    $thinkMax = $using:ThinkMaxMs

    # The SPA's own id shape, one per person, so a per-session limiter sees a
    # room rather than a single caller.
    $session = "{0}-{1}" -f (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ'), [guid]::NewGuid()
    $headers = @{ 'X-Aggregate-Session' = $session }

    $out = [System.Collections.Generic.List[object]]::new()

    function Hit {
        param($Method, $Path, $Body, $Step)
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $row = [ordered]@{ person = $person; step = $Step; status = 0
                           ms = 0; retryAfter = $null; bytes = 0; note = $null }
        try {
            $args = @{ Uri = "$base$Path"; Method = $Method; Headers = $headers
                       UserAgent = $agent; SkipHttpErrorCheck = $true; TimeoutSec = $timeout }
            if ($Body) { $args.Body = $Body; $args.ContentType = 'application/json' }
            $r = Invoke-WebRequest @args
            $row.status = [int] $r.StatusCode
            $row.ms = [int] $sw.ElapsedMilliseconds
            $row.bytes = $r.Content.Length
            if ($row.status -eq 429) { $row.retryAfter = $r.Headers['Retry-After'] }
            $row.note = $r.Content
        } catch {
            $row.ms = [int] $sw.ElapsedMilliseconds
            $row.status = -1
            $row.note = $_.Exception.Message
        }
        return [pscustomobject] $row
    }

    # Hold until the shared instant, so runspace creation is outside the window.
    $remaining = ($using:startAt - (Get-Date)).TotalMilliseconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }

    # --- the page load ---
    $out.Add((Hit 'GET' '/v1/meta' $null 'meta'))
    $out.Add((Hit 'GET' '/v1/examples' $null 'examples'))

    # --- the landing build, which nobody asked for ---
    $landingRow = Hit 'POST' '/v1/objects' (@{ decl = $landing } | ConvertTo-Json -Compress) 'landing-build'
    $out.Add($landingRow)

    # --- then the examples, with think time, like a person ---
    for ($k = 0; $k -lt $perPerson; $k++) {
        Start-Sleep -Milliseconds (Get-Random -Minimum $thinkMin -Maximum $thinkMax)

        # Stagger which example each person starts on, so the room spreads over
        # the set instead of all landing on the first.
        $pick = $pool[(($person + $k) % $pool.Count)]
        $buildRow = Hit 'POST' '/v1/objects' (@{ decl = $pick.decl } | ConvertTo-Json -Compress) 'example-build'
        $out.Add($buildRow)
        if ($buildRow.status -ne 200) { continue }

        $oid = $null
        try { $oid = ($buildRow.note | ConvertFrom-Json).id } catch { }
        if (-not $oid) { continue }

        Start-Sleep -Milliseconds (Get-Random -Minimum $thinkMin -Maximum $thinkMax)
        $out.Add((Hit 'GET' "/v1/objects/$oid/summary" $null 'summary'))

        $exRow = Hit 'GET' "/v1/objects/$oid/exhibits" $null 'exhibits'
        $out.Add($exRow)
        if ($exRow.status -eq 200) {
            $names = $null
            try { $names = ($exRow.note | ConvertFrom-Json).exhibits } catch { }
            $first = @($names)[0]
            if ($first -and $first -isnot [string]) { $first = $first.name }
            if ($first) {
                Start-Sleep -Milliseconds (Get-Random -Minimum $thinkMin -Maximum $thinkMax)
                $out.Add((Hit 'GET' "/v1/objects/$oid/exhibit/$first" $null 'exhibit'))
            }
        }

        # The shape web/src/main.js `more:density` actually sends. Not the
        # full grid, which is 30 MB and which the app never asks for.
        Start-Sleep -Milliseconds (Get-Random -Minimum $thinkMin -Maximum $thinkMax)
        $out.Add((Hit 'GET' "/v1/objects/$oid/density_df?resolution=display&cols=loss,p_total,F,S" $null 'density'))
    }

    # Drop the bodies before returning: fifty people times a few reads is a lot
    # of JSON to carry back into the parent runspace, and only the 429 text is
    # worth keeping.
    foreach ($r in $out) {
        if ($r.status -ne 429 -and $r.status -ne -1) { $r.note = $null }
        elseif ($r.note -and $r.note.Length -gt 120) { $r.note = $r.note.Substring(0, 120) }
    }
    $out
}

$wall.Stop()
$after = Get-Status $StatusUrl

# ----------------------------------------------------------------------
# What happened
# ----------------------------------------------------------------------
function Pct($values, [int] $p) {
    $s = @($values | Sort-Object)
    if ($s.Count -eq 0) { return 0 }
    return $s[[int][Math]::Floor(($p / 100.0) * ($s.Count - 1))]
}

$order = @('meta','examples','landing-build','example-build','summary','exhibits','exhibit','density')

Write-Host ''
Write-Host '--- by step ---' -ForegroundColor Cyan
Write-Host ("{0,-15} {1,6} {2,7} {3,8} {4,8} {5}" -f 'step','calls','ok','p50 ms','p95 ms','other codes')
foreach ($step in $order) {
    $g = @($rows | Where-Object { $_.step -eq $step })
    if ($g.Count -eq 0) { continue }
    $ok = @($g | Where-Object { $_.status -eq 200 }).Count
    $bad = $g | Where-Object { $_.status -ne 200 } | Group-Object status |
           Sort-Object Name | ForEach-Object { "$($_.Name)x$($_.Count)" }
    $color = if ($ok -eq $g.Count) { 'Green' } else { 'Yellow' }
    Write-Host ("{0,-15} {1,6} {2,7} {3,8} {4,8} {5}" -f `
        $step, $g.Count, $ok, (Pct $g.ms 50), (Pct $g.ms 95), ($bad -join ' ')) -ForegroundColor $color
}

$all = @($rows)
$codes = $all | Group-Object status | Sort-Object Name
Write-Host ''
Write-Host '--- totals ---' -ForegroundColor Cyan
Write-Host ("people           : {0}" -f $People)
Write-Host ("requests         : {0}" -f $all.Count)
Write-Host ("wall clock       : {0:N1} s" -f ($wall.ElapsedMilliseconds / 1000))
Write-Host ("latency overall  : p50 {0} ms   p95 {1} ms   max {2} ms" -f `
    (Pct $all.ms 50), (Pct $all.ms 95), (Pct $all.ms 100))
Write-Host 'status codes     :'
foreach ($c in $codes) {
    $label = switch ($c.Name) {
        '200' { 'ok' }
        '429' { 'RATE LIMITED by Caddy (the room shares an IP budget)' }
        '503' { 'object busy, server shed the read' }
        '504' { 'build timed out in the queue' }
        '502' { 'BAD GATEWAY: the app stopped answering' }
        '-1'  { 'client error or timeout' }
        default { '' }
    }
    $color = if ($c.Name -eq '200') { 'Green' } elseif ($c.Name -in @('429','503')) { 'Yellow' } else { 'Red' }
    Write-Host ("                   HTTP {0,-5} x{1,-5} {2}" -f $c.Name, $c.Count, $label) -ForegroundColor $color
}

$limited = @($all | Where-Object { $_.status -eq 429 })
if ($limited.Count) {
    $ra = @($limited.retryAfter | Where-Object { $_ } | Select-Object -Unique) -join ', '
    Write-Host ''
    Write-Host ("{0} of {1} build requests were rate limited. Retry-After: {2}" -f `
        $limited.Count, @($all | Where-Object { $_.step -like '*build' }).Count, $(if ($ra) { $ra } else { 'not sent' })) -ForegroundColor Yellow
    Write-Host ("sample body: {0}" -f (@($limited.note | Where-Object { $_ })[0])) -ForegroundColor DarkGray
}

# Is the site still there?
Write-Host ''
$sw = [Diagnostics.Stopwatch]::StartNew()
try {
    $h = Invoke-WebRequest "$BaseUrl/v1/health" -UserAgent $AGENT -SkipHttpErrorCheck -TimeoutSec 20
    Write-Host ("health after     : HTTP {0} in {1} ms" -f $h.StatusCode, $sw.ElapsedMilliseconds) `
        -ForegroundColor $(if ($h.StatusCode -eq 200) { 'Green' } else { 'Red' })
} catch {
    Write-Host ("health after     : UNREACHABLE after {0} ms  <-- the server is down" -f $sw.ElapsedMilliseconds) -ForegroundColor Red
}

if ($before -and $after) {
    Write-Host ''
    Write-Host '--- server side, before -> after ---' -ForegroundColor Cyan
    Write-Host ("builds started   : {0} -> {1}" -f $before.builds.live.started, $after.builds.live.started)
    Write-Host ("build timeouts   : {0} -> {1}" -f $before.builds.live.timeouts, $after.builds.live.timeouts)
    Write-Host ("object cache     : {0} -> {1} of {2} entries" -f `
        $before.cache.entries, $after.cache.entries, $after.settings.cache_max)
    Write-Host ("cache hit rate   : {0}" -f $after.cache.hit_rate)
    Write-Host ("exhibit cache    : {0}" -f ($after.exhibit_cache | ConvertTo-Json -Compress))
    Write-Host ("chart cache      : {0}" -f ($after.chart_cache | ConvertTo-Json -Compress))
    Write-Host ("live sessions    : {0} -> {1} of {2}" -f `
        $before.sessions.live, $after.sessions.live, $after.settings.session_max)
    Write-Host ("key scope        : shared {0}, session {1}" -f `
        $after.key_scope.shared, $after.key_scope.session)
    if ($after.resources.rss_bytes) {
        Write-Host ("process RSS      : {0:N0} MB" -f ($after.resources.rss_bytes / 1MB))
    }
} elseif (-not $StatusUrl) {
    Write-Host ''
    Write-Host 'Pass -StatusUrl http://10.8.0.1:19456/v1/status for the server-side counters.' -ForegroundColor DarkGray
}
Write-Host ''
