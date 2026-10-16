#!/usr/bin/env bash
# Build the Excel add-in into src/aggregate_api/excel_static/, served at /excel.
#
# Usage:
#   ./scripts/build-excel.sh                                  # for agg.mynl.com
#   ./scripts/build-excel.sh https://other.host/excel         # another origin
#
# A production build: the functions call the origin that serves them (an empty
# API base), and the bundle carries the production manifest.xml, with every URL
# under the base and <Version> taken from __version__ in
# src/aggregate_api/__init__.py, padded to four parts (1.17.0 becomes
# 1.17.0.0). Office reads that version to decide whether a workbook needs the
# new add-in, so build after every bump that is deployed.
#
# Users install from <base>/manifest.xml; see excel/README.md. The first deploy
# needs one restart of the server, which mounts /excel only when the directory
# exists.
#
# npm dependencies are refreshed when node_modules is missing or older than
# package.json/package-lock.json, as in build-web.sh.

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
excel_dir="$script_dir/../excel"
out_dir="$script_dir/../src/aggregate_api/excel_static"

export AGG_ADDIN_BASE="${1:-https://agg.mynl.com/excel}"

cd "$excel_dir"

install_deps=0
if [[ ! -d node_modules ]]; then
    install_deps=1
elif [[ package-lock.json -nt node_modules || package.json -nt node_modules ]]; then
    install_deps=1
fi

if [[ "$install_deps" == "1" ]]; then
    echo "Installing npm dependencies..."
    npm install --no-fund --no-audit
fi

echo "Building the Excel add-in for $AGG_ADDIN_BASE into $out_dir ..."
npm run build -- --output-path "$out_dir"
