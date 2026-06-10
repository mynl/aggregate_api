# Build the aggregate SPA into src/aggregate_api/static/.
#
# Usage:
#   .\scripts\build-web.ps1                                # same-origin root build
#   .\scripts\build-web.ps1 -ApiBase https://api.mynl.com   # split-origin api build
#   .\scripts\build-web.ps1 -ApiBase /Q7M4Z9KP              # hidden subpath build
#
# The optional -ApiBase value becomes VITE_API_BASE_URL for Vite. The frontend
# code reads that value in web/src/config.js and prepends it to every fetch()
# wrapper in web/src/api.js.
#
# Examples:
#   no -ApiBase           -> fetch('/v1/health')
#   -ApiBase /Q7M4Z9KP   -> fetch('/Q7M4Z9KP/v1/health')
#   -ApiBase https://... -> fetch('https://.../v1/health')
#
# This matters for a Caddy `handle_path /Q7M4Z9KP/*` deployment: the browser
# must request /Q7M4Z9KP/v1/... so Caddy can match the hidden prefix, strip it,
# and proxy /v1/... to FastAPI.
#
# The script does not assume the working directory; it resolves
# everything relative to its own location so it's callable from
# anywhere (CI, package step, ad-hoc terminal).

[CmdletBinding()]
param(
    [string]$ApiBase = ""
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$webDir    = Join-Path $scriptDir "..\web" | Resolve-Path

Push-Location $webDir
try {
    if ($ApiBase) {
        # Vite exposes env vars beginning with VITE_ to the browser bundle at
        # build time. This value is baked into the generated static JS until the
        # next build, so changing the Caddy prefix requires rebuilding the SPA.
        $env:VITE_API_BASE_URL = $ApiBase
        Write-Host "Building with VITE_API_BASE_URL=$ApiBase"
    }
    if (-not (Test-Path "node_modules")) {
        Write-Host "Installing npm dependencies..."
        npm install --no-fund --no-audit
    }
    Write-Host "Running vite build..."
    npm run build
} finally {
    Pop-Location
    if ($ApiBase) { Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue }
}
