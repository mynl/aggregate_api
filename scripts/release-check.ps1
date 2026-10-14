# Rehearse a release: build the distributions, look inside them, and run the
# whole test suite against the installed wheel in an environment that has never
# heard of this working tree.
#
# Usage:
#   .\scripts\release-check.ps1                  # full rehearsal
#   .\scripts\release-check.ps1 -SkipWebBuild    # trust the bundle on disk
#   .\scripts\release-check.ps1 -KeepVenv        # leave the venv for poking at
#
# Why this exists. Everything the suites check, they check against `web/src` and
# `src/` in place, so all of it can be green while the thing an installer
# receives is broken. Three defects found exactly that way before 1.0.0, each
# invisible to `uv run pytest`:
#
#   1. `[tool.uv.sources]` made `uv pip install git+...` fail outright, because
#      uv honors the table for a git-installed project and looked for the
#      sibling worktree path inside the GitHub repo.
#   2. `package-data = ["static/*"]` shipped `index.html` and none of the
#      thirteen scripts and stylesheets it loads, because a package_data glob
#      does not recurse. The installed app served a 200 for `/` and a 404 for
#      every asset: a painted shell that did nothing.
#   3. One test asserted route mounting by walking `app.routes`, which newer
#      FastAPI no longer flattens. It passed on the locked dev pins and failed
#      on the pins a fresh install resolves, which is what an outside user has.
#
# So the rehearsal is the gate, not the suites. Run it before `uv publish` and
# before tagging. See dev/done/plan-1.0.0-release.md.
#
# The script resolves everything from its own location and never assumes a
# working directory. The throwaway environment goes under the system temp
# directory, never into the repo.

[CmdletBinding()]
param(
    # Skip `scripts\build-web.ps1`. The wheel must still contain a bundle, so
    # this only helps when one was built moments ago.
    [switch]$SkipWebBuild,
    # Leave the throwaway virtual environment and the built distributions in
    # place, and print where they are.
    [switch]$KeepVenv,
    # Python for the throwaway environment. The floor is 3.13.
    [string]$PythonVersion = "3.13"
)

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Join-Path $scriptDir ".." | Resolve-Path

$stage    = Join-Path ([System.IO.Path]::GetTempPath()) "aggregate-api-release-check"
$distDir  = Join-Path $stage "dist"
$venvDir  = Join-Path $stage "venv"

function Write-Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Write-Good([string]$text) { Write-Host "   ok: $text" -ForegroundColor Green }

Push-Location $repoRoot
try {
    # The one place the version is written since 1.9.1; pyproject.toml reads it.
    $version = (Select-String -Path "src/aggregate_api/__init__.py" -Pattern '^__version__\s*=\s*"(.+)"' |
        Select-Object -First 1).Matches[0].Groups[1].Value
    Write-Host "aggregate_api $version, rehearsing a release" -ForegroundColor White

    # ---------------------------------------------------------------- 1. bundle
    if (-not $SkipWebBuild) {
        Write-Step "Building the SPA bundle"
        & (Join-Path $scriptDir "build-web.ps1")
        if ($LASTEXITCODE -ne 0) { throw "build-web.ps1 failed" }
    } else {
        Write-Step "Skipping the SPA build (-SkipWebBuild)"
    }

    $indexPath = Join-Path $repoRoot "src\aggregate_api\static\index.html"
    if (-not (Test-Path $indexPath)) {
        throw "No src\aggregate_api\static\index.html. A wheel built now would ship no app; run scripts\build-web.ps1."
    }
    Write-Good "index.html present"

    # ------------------------------------------------------------- 2. the suites
    Write-Step "Running the Python suite in the dev environment"
    uv run --no-sync pytest -q
    if ($LASTEXITCODE -ne 0) { throw "pytest failed in the dev environment" }

    Write-Step "Running the web suite"
    Push-Location (Join-Path $repoRoot "web")
    try {
        npm test
        if ($LASTEXITCODE -ne 0) { throw "npm test failed" }
    } finally { Pop-Location }

    # -------------------------------------------------------------- 3. the build
    Write-Step "Building the sdist and the wheel"
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $distDir | Out-Null
    uv build --out-dir $distDir
    if ($LASTEXITCODE -ne 0) { throw "uv build failed" }

    $wheel = Get-ChildItem (Join-Path $distDir "*.whl") | Select-Object -First 1
    $sdist = Get-ChildItem (Join-Path $distDir "*.tar.gz") | Select-Object -First 1
    if (-not $wheel) { throw "uv build produced no wheel" }
    if (-not $sdist) { throw "uv build produced no sdist" }
    Write-Good "$($wheel.Name) ($([math]::Round($wheel.Length / 1MB, 2)) MB)"
    Write-Good "$($sdist.Name)"

    # ------------------------------------------------- 4. look inside the wheel
    # The defect this catches ships a page and withholds everything it loads,
    # and nothing upstream of here can see it.
    Write-Step "Inspecting the wheel"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($wheel.FullName)
    try {
        $names = $zip.Entries | ForEach-Object { $_.FullName }
    } finally { $zip.Dispose() }

    if ($names -notcontains "aggregate_api/static/index.html") {
        throw "The wheel has no aggregate_api/static/index.html."
    }
    Write-Good "carries static/index.html"

    $assets = $names | Where-Object { $_ -like "aggregate_api/static/assets/*" }
    $scripts = $assets | Where-Object { $_ -like "*.js" }
    $styles  = $assets | Where-Object { $_ -like "*.css" }
    if (-not $scripts) {
        throw "The wheel carries no static/assets/*.js. Check [tool.setuptools.package-data]: a package_data glob does not recurse, so static/assets/* must be its own entry."
    }
    if (-not $styles) {
        throw "The wheel carries no static/assets/*.css. Check [tool.setuptools.package-data]."
    }
    Write-Good "carries $($assets.Count) asset(s): $($scripts.Count) js, $($styles.Count) css"

    if ($names -notcontains "aggregate_api/status_page.html") {
        throw "The wheel has no aggregate_api/status_page.html; /v1/status would 500."
    }
    Write-Good "carries status_page.html"

    # Every asset index.html names must be in the wheel, not merely some assets.
    $referenced = [regex]::Matches(
        (Get-Content $indexPath -Raw),
        '(?:src|href)\s*=\s*["'']\.?/?(assets/[^"'']+)["'']'
    ) | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
    $absent = $referenced | Where-Object { $names -notcontains "aggregate_api/static/$_" }
    if ($absent) {
        throw "index.html loads file(s) the wheel does not carry: $($absent -join ', ')"
    }
    Write-Good "all $($referenced.Count) asset(s) index.html loads are in the wheel"

    # ----------------------------------------- 5. install it somewhere clean
    Write-Step "Installing the wheel into a clean environment"
    uv venv --python $PythonVersion $venvDir
    if ($LASTEXITCODE -ne 0) { throw "uv venv failed" }
    $venvPython = Join-Path $venvDir "Scripts\python.exe"

    # `uv pip install <wheel>` reads no project metadata, so nothing in this
    # tree, [tool.uv.sources] included, can reach the resolution. Every
    # dependency comes from PyPI, which is the point.
    uv pip install --python $venvPython $wheel.FullName pytest httpx
    if ($LASTEXITCODE -ne 0) { throw "installing the wheel failed" }

    $resolved = & $venvPython -c @'
import importlib.metadata as m
for p in ("aggregate_api", "aggregate", "greater-tables", "fastapi", "starlette"):
    print(f"   {p} {m.version(p)}")
'@
    Write-Host "   resolved from PyPI:" -ForegroundColor Gray
    $resolved | ForEach-Object { Write-Host $_ -ForegroundColor Gray }

    # ----------------------------------------------- 6. the suite, as installed
    # Run from the repo root so `tests/` is found. `src/` is not importable from
    # here (package-dir = src), so `import aggregate_api` resolves to the wheel.
    Write-Step "Running the Python suite against the installed wheel"
    & $venvPython -c "import aggregate_api, pathlib; print('   importing from', pathlib.Path(aggregate_api.__file__).parent)"
    & $venvPython -m pytest -q -p no:cacheprovider
    if ($LASTEXITCODE -ne 0) { throw "pytest failed against the installed wheel" }

    # ------------------------------------------ 7. serve the app, as installed
    # The end of the chain: the assets are in the wheel, and the installed app
    # actually answers for them.
    Write-Step "Serving the installed app and fetching every asset"
    & $venvPython -c @'
import re, sys
from fastapi.testclient import TestClient
from aggregate_api.app import create_app

client = TestClient(create_app())
page = client.get("/")
if page.status_code != 200:
    sys.exit(f"GET / returned {page.status_code}")

refs = {r.split("?", 1)[0] for r in re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', page.text)
        if not r.startswith(("http://", "https://", "//", "data:", "#"))}
bad = [(r, client.get(r).status_code) for r in sorted(refs) if client.get(r).status_code != 200]
if bad:
    sys.exit("the installed app does not serve: " + ", ".join(f"{r} -> {c}" for r, c in bad))
print(f"   GET / 200, and all {len(refs)} referenced file(s) 200")

meta = client.get("/v1/meta").json()
print(f"   /v1/meta: version {meta['version']}, aggregate {meta['aggregate_version']}, tables {meta['tables_version']}")
'@
    if ($LASTEXITCODE -ne 0) { throw "the installed app did not serve its own assets" }

    Write-Host "`nRelease check passed for $version." -ForegroundColor Green
    Write-Host "Distributions: $distDir" -ForegroundColor Gray
    Write-Host @"

Next, and all of it the author's:
  git push                                    # the commits first
  uv publish $distDir\*                       # needs a token, or Trusted Publishing
  git tag -a v$version -m "aggregate_api $version"
  git push --tags
  gh release create v$version $distDir\* --title "aggregate_api $version" --notes-file <notes>
"@ -ForegroundColor Gray
} finally {
    Pop-Location
    if ($KeepVenv) {
        Write-Host "Left in place: $stage" -ForegroundColor Gray
    } elseif (Test-Path $venvDir) {
        Remove-Item $venvDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
