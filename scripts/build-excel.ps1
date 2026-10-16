# Build the Excel add-in into src/aggregate_api/excel_static/, served at /excel.
#
# Usage:
#   .\scripts\build-excel.ps1                                      # for agg.mynl.com
#   .\scripts\build-excel.ps1 -Base https://other.host/excel       # another origin
#
# A production build: the functions call the origin that serves them (an empty
# API base), and the bundle carries the production manifest.xml, with every URL
# under -Base and <Version> taken from __version__ in
# src/aggregate_api/__init__.py, padded to four parts (1.17.0 becomes
# 1.17.0.0). Office reads that version to decide whether a workbook needs the
# new add-in, so build after every bump that is deployed.
#
# Users install from <Base>/manifest.xml; see excel/README.md.
#
# npm dependencies are refreshed when node_modules is missing or older than
# package.json/package-lock.json, as in build-web.ps1.
#
# The script resolves everything relative to its own location, so it is
# callable from anywhere.

[CmdletBinding()]
param(
    [string]$Base = "https://agg.mynl.com/excel"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$excelDir  = Join-Path $scriptDir "..\excel" | Resolve-Path
$outDir    = Join-Path $scriptDir "..\src\aggregate_api\excel_static"

Push-Location $excelDir
try {
    $env:AGG_ADDIN_BASE = $Base
    $installDeps = -not (Test-Path "node_modules")
    if (-not $installDeps) {
        $nodeModules = Get-Item "node_modules"
        $packageJson = Get-Item "package.json"
        $packageLock = Get-Item "package-lock.json"
        $installDeps = (
            $packageJson.LastWriteTimeUtc -gt $nodeModules.LastWriteTimeUtc -or
            $packageLock.LastWriteTimeUtc -gt $nodeModules.LastWriteTimeUtc
        )
    }
    if ($installDeps) {
        Write-Host "Installing npm dependencies..."
        npm install --no-fund --no-audit
    }
    Write-Host "Building the Excel add-in for $Base into $outDir ..."
    npm run build -- --output-path "$outDir"
    if ($LASTEXITCODE -ne 0) { throw "webpack failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
    Remove-Item Env:AGG_ADDIN_BASE -ErrorAction SilentlyContinue
}
