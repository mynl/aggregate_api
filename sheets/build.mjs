/*
 * Build the Apps Script project in dist/, which `clasp push` uploads.
 *
 *   dist/core.js        excel/src/functions/core.ts bundled by esbuild as an
 *                       IIFE assigned to the global AggCore. Apps Script has no
 *                       modules, so this is how the shared core arrives.
 *   dist/<name>.js      each src/<name>.ts with its types stripped by
 *                       TypeScript's transpileModule, and nothing else. Not
 *                       esbuild: esbuild drops comments, and Sheets reads the
 *                       @customfunction JSDoc tags for autocomplete, which the
 *                       author ruled required. Top-level functions stay top
 *                       level, which is what makes them callable from a cell.
 *   dist/appsscript.json  copied.
 *
 * Two names are stamped into the stripped files: __AGG_CLIENT_VERSION__, the
 * server's __version__ read from src/aggregate_api/__init__.py the way
 * excel/webpack.config.js reads it, because every copy of the template
 * freezes its client at the version it was copied from; and __AGG_API_BASE__,
 * https://agg.mynl.com unless AGG_API_BASE says otherwise. Google's servers
 * make the requests, so a local server is unreachable from Sheets.
 */

import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const dist = join(here, "dist");

/** The server's version, from the one place it is written. */
function clientVersion() {
  const init = join(repo, "src", "aggregate_api", "__init__.py");
  const match = /^__version__ = "([^"]+)"/m.exec(readFileSync(init, "utf8"));
  if (!match) throw new Error(`no __version__ in ${init}`);
  return match[1];
}

const stamps = {
  __AGG_CLIENT_VERSION__: JSON.stringify(clientVersion()),
  __AGG_API_BASE__: JSON.stringify((process.env.AGG_API_BASE || "https://agg.mynl.com").replace(/\/+$/, "")),
};

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);

await build({
  entryPoints: [join(repo, "excel", "src", "functions", "core.ts")],
  bundle: true,
  format: "iife",
  globalName: "AggCore",
  target: "es2019",
  outfile: join(dist, "core.js"),
  logLevel: "warning",
});

for (const file of readdirSync(join(here, "src")).filter((name) => name.endsWith(".ts"))) {
  const source = readFileSync(join(here, "src", file), "utf8");
  let { outputText } = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2019, module: ts.ModuleKind.ESNext },
  });
  // A module wrapper or an import would hide every function from Sheets.
  if (/^\s*(import|export)\b/m.test(outputText)) {
    throw new Error(`src/${file} compiled to a module; Apps Script needs a plain script`);
  }
  for (const [name, value] of Object.entries(stamps)) outputText = outputText.split(name).join(value);
  writeFileSync(join(dist, file.replace(/\.ts$/, ".js")), outputText);
}

copyFileSync(join(here, "appsscript.json"), join(dist, "appsscript.json"));
console.log(`dist/ built for AGG for Sheets ${JSON.parse(stamps.__AGG_CLIENT_VERSION__)}`);
