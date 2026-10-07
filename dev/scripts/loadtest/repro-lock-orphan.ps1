<#
.SYNOPSIS
    Prove that one abandoned read permanently orphans a CacheEntry lock.

.DESCRIPTION
    `_locked_entry` (src/aggregate_api/routes/objects.py:654) holds a
    CacheEntry's lock for the whole request, acquiring it before a `yield` and
    releasing it after. The release is driven by FastAPI's exit-stack teardown.
    When a client disconnects mid-request that teardown can fail to run, and
    because a `threading.Lock` has no owner and no timeout the lock is then held
    forever by nobody.

    Consequences, in the order this script demonstrates them:

      stage 2  one aborted read poisons that object: every later read of it
               blocks forever, while the rest of the server still works;
      stage 4  forty blocked reads exhaust anyio's thread limiter (default 40
               tokens), and from then on **every** synchronous route is
               unreachable, `/v1/health` included, because a sync route needs a
               token and there are none left. The process sits at 0% CPU.

    This needs no load generator and no concurrency. One disconnect is enough,
    which is why it is a correctness bug rather than a capacity one: a closed
    tab, a reload, or a phone moving from WiFi to cellular will do it.

    The object is built fresh on every run, with a unique name and claim count,
    so its lazily materialized frames are cold and the locked critical section
    is wide enough to abort inside reliably.

.PARAMETER BaseUrl
    Where the api is.

.PARAMETER HoldMs
    How long to leave the aborted request running before slamming the socket.
    Long enough for the handler to acquire the lock and start work, short
    enough that it cannot finish.

.PARAMETER Escalate
    Also run stage 4, which kills the server outright. The server must be
    restarted afterwards; nothing recovers it.

.EXAMPLE
    .\repro-lock-orphan.ps1
    Stages 1 to 3: proves the object is poisoned, leaves the server usable.

.EXAMPLE
    .\repro-lock-orphan.ps1 -Escalate
    All four stages: proves the whole process dies. Restart the server after.

.NOTES
    The abort is a raw socket with LingerOption(true, 0), so closing sends a
    TCP reset rather than a graceful FIN. That is the hardest disconnect a
    browser can produce and the least ambiguous for the server to observe.
#>
[CmdletBinding()]
param(
    [string] $BaseUrl = 'http://127.0.0.1:8001',
    [int]    $HoldMs = 120,
    [switch] $Escalate,
    [int]    $ProbeTimeoutSec = 8
)

$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Needs PowerShell 7.' }

$uri = [Uri] $BaseUrl
$apiHost = $uri.Host
$port = $uri.Port

function Probe([string] $path, [int] $timeoutSec) {
    <# Returns a row saying whether the route answered, and how long it took. #>
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $r = Invoke-WebRequest -Uri "$BaseUrl$path" -SkipHttpErrorCheck -TimeoutSec $timeoutSec
        return [pscustomobject]@{ path = $path; status = [int] $r.StatusCode
                                  ms = [int] $sw.ElapsedMilliseconds; hung = $false }
    } catch {
        return [pscustomobject]@{ path = $path; status = $null
                                  ms = [int] $sw.ElapsedMilliseconds; hung = $true }
    }
}

Write-Host ''
Write-Host "repro: orphaned CacheEntry lock -> $BaseUrl" -ForegroundColor Cyan

# ----------------------------------------------------------------------
# Stage 1: a fresh object, so its lazy frames are cold
# ----------------------------------------------------------------------
$claims = 200 + (Get-Random -Maximum 400)
$name = "Repro$((Get-Date -Format 'HHmmss'))"
$program = "agg $name`n  $claims claims`n  1000 xs 0`n  sev lognorm 100 cv 1.5`n  poisson`n"
$body = @{ decl = $program } | ConvertTo-Json -Compress

$build = Invoke-WebRequest -Uri "$BaseUrl/v1/objects" -Method POST -Body $body `
    -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec 60
if ($build.StatusCode -ne 200) { throw "build failed HTTP $($build.StatusCode): $($build.Content)" }
$oid = ($build.Content | ConvertFrom-Json).id
Write-Host "stage 1: built $name as $oid" -ForegroundColor DarkGray

$exList = Invoke-WebRequest -Uri "$BaseUrl/v1/objects/$oid/exhibits" -SkipHttpErrorCheck -TimeoutSec 30
$names = ($exList.Content | ConvertFrom-Json).exhibits
$first = @($names)[0]
if ($first -isnot [string]) { $first = $first.name }
$target = "/v1/objects/$oid/exhibit/$first"
Write-Host "stage 1: locked route under test is $target" -ForegroundColor DarkGray

# ----------------------------------------------------------------------
# Stage 2: send a read, then abort it mid-flight with a reset
# ----------------------------------------------------------------------
$client = [System.Net.Sockets.TcpClient]::new($apiHost, $port)
$stream = $client.GetStream()
$req = "GET $target HTTP/1.1`r`nHost: ${apiHost}:${port}`r`nX-Aggregate-Session: repro`r`nConnection: close`r`n`r`n"
$bytes = [Text.Encoding]::ASCII.GetBytes($req)
$stream.Write($bytes, 0, $bytes.Length)
$stream.Flush()
Start-Sleep -Milliseconds $HoldMs
# LingerOption(true, 0) makes Close send RST instead of FIN: the hardest abort.
$client.Client.LingerState = [System.Net.Sockets.LingerOption]::new($true, 0)
$client.Close()
Write-Host "stage 2: aborted that read after $HoldMs ms with a TCP reset" -ForegroundColor DarkGray
Start-Sleep -Milliseconds 400

# ----------------------------------------------------------------------
# Stage 3: is that one object poisoned, and is the rest of the server fine?
# ----------------------------------------------------------------------
Write-Host ''
Write-Host '--- stage 3: after one aborted read ---' -ForegroundColor Cyan
$sameObject = Probe "/v1/objects/$oid/summary" $ProbeTimeoutSec
$health = Probe '/v1/health' 5
$otherObject = $null
try {
    $body2 = @{ decl = "agg Other$name`n  7 claims`n  dsev [1:6]`n  poisson`n" } | ConvertTo-Json -Compress
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $b2 = Invoke-WebRequest -Uri "$BaseUrl/v1/objects" -Method POST -Body $body2 `
        -ContentType 'application/json' -SkipHttpErrorCheck -TimeoutSec $ProbeTimeoutSec
    $otherObject = [pscustomobject]@{ path = 'POST /v1/objects (different program)'
        status = [int] $b2.StatusCode; ms = [int] $sw.ElapsedMilliseconds; hung = $false }
} catch {
    $otherObject = [pscustomobject]@{ path = 'POST /v1/objects (different program)'
        status = $null; ms = $ProbeTimeoutSec * 1000; hung = $true }
}

@($sameObject, $otherObject, $health) | ForEach-Object {
    $verdict = if ($_.hung) { 'HUNG' } else { "HTTP $($_.status)" }
    $color = if ($_.hung) { 'Red' } else { 'Green' }
    Write-Host ("  {0,-44} {1,6} ms  {2}" -f $_.path, $_.ms, $verdict) -ForegroundColor $color
}

Write-Host ''
if ($sameObject.hung -and -not $health.hung) {
    Write-Host 'VERDICT: lock orphaned. That object is dead; the server still answers.' -ForegroundColor Red
} elseif (-not $sameObject.hung) {
    Write-Host 'VERDICT: no orphan observed. The lock was released on disconnect.' -ForegroundColor Green
    Write-Host '         Try a larger -HoldMs, or the abort landed outside the critical section.' -ForegroundColor DarkGray
} else {
    Write-Host 'VERDICT: server already unhealthy before stage 4; interpret with care.' -ForegroundColor Yellow
}

# ----------------------------------------------------------------------
# Stage 4: exhaust the thread limiter and take the whole process down
# ----------------------------------------------------------------------
if ($Escalate) {
    Write-Host ''
    Write-Host '--- stage 4: 40 concurrent reads of the poisoned object ---' -ForegroundColor Cyan
    Write-Host 'this kills the server for good; restart it afterwards' -ForegroundColor DarkGray
    $null = 1..40 | ForEach-Object -ThrottleLimit 40 -Parallel {
        try {
            Invoke-WebRequest -Uri "$($using:BaseUrl)/v1/objects/$($using:oid)/summary" `
                -SkipHttpErrorCheck -TimeoutSec 3 | Out-Null
        } catch { }
    }
    Start-Sleep -Seconds 2
    $deadHealth = Probe '/v1/health' 8
    $deadMeta = Probe '/v1/meta' 8
    @($deadHealth, $deadMeta) | ForEach-Object {
        $verdict = if ($_.hung) { 'HUNG' } else { "HTTP $($_.status)" }
        $color = if ($_.hung) { 'Red' } else { 'Green' }
        Write-Host ("  {0,-44} {1,6} ms  {2}" -f $_.path, $_.ms, $verdict) -ForegroundColor $color
    }
    Write-Host ''
    if ($deadHealth.hung) {
        Write-Host 'VERDICT: thread limiter exhausted. Every sync route is now unreachable.' -ForegroundColor Red
        Write-Host '         The process will sit at 0% CPU until restarted.' -ForegroundColor Red
    } else {
        Write-Host 'VERDICT: server survived 40 blocked reads. The limiter is wider than 40.' -ForegroundColor Yellow
    }
}
Write-Host ''
