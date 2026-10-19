/**
 * What build.mjs writes, and what the template set-up writes into a spreadsheet.
 *
 * Run: `npm test` from `sheets/`, which builds dist/ first.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { harness, plain, recordingSheet } from "./harness.ts";

const FUNCTIONS = ["VERSION", "BUILD", "EXHIBITS", "EXHIBIT", "Q", "FRAMES", "FRAMEURL", "LIBRARY", "PROGRAM"];

function dist(name: string): string {
  return readFileSync(new URL(`../dist/${name}`, import.meta.url), "utf8");
}

test("the stripped files are plain scripts that keep their JSDoc", () => {
  for (const file of ["functions.js", "menu.js", "template.js"]) {
    assert.doesNotMatch(dist(file), /^\s*(import|export)\b/m, file);
    assert.doesNotMatch(dist(file), /__AGG_[A-Z_]+__/, `${file} carries no unstamped name`);
  }
  const functions = dist("functions.js");
  for (const name of FUNCTIONS) {
    const tagged = new RegExp(`@customfunction\\s*\\*/\\s*function AGG_${name}\\(`);
    assert.match(functions, tagged, `AGG_${name} is tagged for autocomplete`);
  }
  assert.equal((functions.match(/@customfunction/g) ?? []).length, FUNCTIONS.length);
  assert.match(dist("core.js"), /var AggCore = /);
});

test("the manifest asks for exactly the three scopes", () => {
  const manifest = JSON.parse(dist("appsscript.json"));
  assert.equal(manifest.runtimeVersion, "V8");
  assert.deepEqual(manifest.oauthScopes.map((s: string) => s.split("/").at(-1)),
                   ["script.external_request", "spreadsheets.currentonly", "script.container.ui"]);
});

test("the set-up writes Start here and Example, the program from the library", () => {
  const h = harness();
  const log: { sheet: string; where: string; method: string; args: unknown[] }[] = [];
  h.spreadsheet.makeSheet = (name: string) => recordingSheet(name, log);
  h.script.aggSetUpTemplate();
  assert.deepEqual(h.spreadsheet.sheets.map((s: { name: string }) => s.name), ["Start here", "Example"]);
  const formulas = log.filter((c) => c.method === "setFormula").map((c) => `${c.sheet}!${c.where} ${c.args[0]}`);
  assert.deepEqual(formulas, [
    "Start here!4,2 =AGG_VERSION()",
    "Example!C2 =AGG_BUILD(A2:A20)",
    'Example!C5 =AGG_EXHIBIT(C2, "summary")',
    "Example!D13 =AGG_Q(C2, C13:C17)",
    "Example!F13 =AGG_FRAMES(C2)",
    'Example!L2 =IMPORTDATA(AGG_FRAMEURL(C2, "stats_df"))',
  ]);
  const program = log.find((c) => c.sheet === "Example" && c.method === "setValues" && c.where.startsWith("2,1"));
  assert.deepEqual(plain(program?.args[0]), [["agg BasicBook"], ["  250 claims"], ["  1000 xs 0"],
                                      ["  sev lognorm 100 cv 1.5"], ["  poisson"]]);
  assert.deepEqual(h.log.at(-1), ["active", "Start here"]);
  // House style reaches the user: no dash used as punctuation in the text.
  const text = JSON.stringify(log.filter((c) => c.method === "setValues").map((c) => c.args));
  assert.doesNotMatch(text, /—| -- | - /);
});
