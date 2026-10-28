/**
 * The AGG_ functions, over the built dist/ in a vm with a fake server.
 *
 * Run: `npm test` from `sheets/`, which builds dist/ first.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SPREADSHEET_ID, TWEEDIE_PROGRAM, TWEEDIE_TEXT, fixture, harness, plain } from "./harness.ts";

const PROGRAM = "agg A 2 claims sev lognorm 10 cv 1 poisson";
const HANDLE = /^agg\.A#[0-9a-f]{16}$/;

function serverVersion(): string {
  const init = readFileSync(new URL("../../src/aggregate_api/__init__.py", import.meta.url), "utf8");
  return (/^__version__ = "([^"]+)"/m.exec(init) as RegExpExecArray)[1];
}

// ----------------------------------------------------------------------
// Versions, sessions, builds
// ----------------------------------------------------------------------

test("AGG_VERSION reports this copy, the server and the library", () => {
  const h = harness();
  assert.equal(h.script.AGG_VERSION(), `AGG for Sheets ${serverVersion()}; aggregate_api 9.9.9, aggregate 1.5.2`);
});

test("every request carries the session id: sheets: and a digest of the spreadsheet id", () => {
  const h = harness();
  h.script.AGG_BUILD(PROGRAM);
  const session = h.requests[0].headers["X-Aggregate-Session"];
  assert.equal(session, `sheets:${h.sha256(SPREADSHEET_ID)}`);
  assert.match(session, /^[A-Za-z0-9:.\-_]{8,200}$/, "the shape the server accepts");
  assert.ok(!session.includes(SPREADSHEET_ID), "the raw id stays off the server");
});

test("AGG_BUILD returns a handle, posts once, and records the recipe", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD([[PROGRAM]]);
  assert.match(handle, HANDLE);
  assert.equal(h.script.AGG_BUILD(PROGRAM), handle, "a second cell is a memo hit");
  assert.equal(h.count("POST", /^\/v1\/objects$/), 1);
  const post = h.requests[0];
  assert.deepEqual(post.payload, { decl: PROGRAM, library_references_only: true });
  const id = handle.split("#")[1];
  assert.deepEqual(JSON.parse(h.props.get(`r:${id}`) as string), { decl: PROGRAM, log2: 0, bs: 0 });
});

test("a range joins row by row, and the grid arguments reach the server and the memo key", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD([["agg A", "2 claims"], ["", ""], ["sev lognorm 10 cv 1", "poisson"]], 12, "");
  assert.match(handle, HANDLE);
  assert.deepEqual(h.requests[0].payload, {
    decl: "agg A\n2 claims\nsev lognorm 10 cv 1\npoisson",
    library_references_only: true,
    log2: 12,
  });
  assert.notEqual(h.script.AGG_BUILD(PROGRAM, 13), handle);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 2);
  assert.equal(h.script.AGG_BUILD(PROGRAM, "twelve"), "#AGG! log2 must be a number; got twelve");
});

test("a refused program reads as #AGG! text, memoized; a value is a number", () => {
  const h = harness();
  const refusal = "#AGG! line 1, col 7: Unexpected 'oops'.";
  assert.equal(h.script.AGG_BUILD("agg A oops"), refusal);
  assert.equal(h.script.AGG_BUILD("agg A oops"), refusal);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 1, "the refusal is memoized");
  assert.equal(h.script.AGG_BUILD("(2+2)"), 4);
  assert.equal(h.script.AGG_BUILD(""), "#AGG! the program is empty");
  assert.equal(h.script.AGG_BUILD(refusal), refusal, "a refusal flows through unchanged");
});

test("a conversion is its text, memoized, and no handle", () => {
  const h = harness();
  assert.equal(h.script.AGG_BUILD(TWEEDIE_PROGRAM), TWEEDIE_TEXT);
  assert.equal(h.script.AGG_BUILD(TWEEDIE_PROGRAM), TWEEDIE_TEXT);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 1, "the text is memoized");
  assert.deepEqual(plain(h.script.AGG_EXHIBITS(TWEEDIE_PROGRAM)),
                   [["#AGG! this program is a number or a conversion, not an object; pass a handle from AGG_BUILD or a program that declares an agg, port, sev or distortion"]]);
});

// ----------------------------------------------------------------------
// Reading an object
// ----------------------------------------------------------------------

test("AGG_EXHIBITS and AGG_EXHIBIT spill, from a handle or from a program", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  const listing = plain(h.script.AGG_EXHIBITS(handle));
  assert.deepEqual(listing[0], ["name", "title", "perspectives"]);
  assert.deepEqual(listing[1], ["summary", "Summary", "raw, insurer"]);
  const summary = plain(h.script.AGG_EXHIBIT(PROGRAM, "summary"));
  assert.equal(summary[0][0], fixture("summary-basicbook").blocks[0].caption);
  assert.deepEqual(summary[1], ["X", "Mean", "SD", "CV", "Skew", "P01", "Median", "P99"]);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 1, "the program in place of the handle is the memo's");
  assert.deepEqual(plain(h.script.AGG_EXHIBIT(handle, "summary", "", 1, false)).map((r: unknown[]) => r[0]),
                   ["Freq", "Sev", "Agg"]);
  assert.match(h.requests.at(-1)!.query.get("perspective")!, /^raw$/);
});

test("an exhibit refusal, a bad block and a bad argument each spill one #AGG! cell", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  assert.deepEqual(plain(h.script.AGG_EXHIBIT(handle, "nope")),
                   [["#AGG! no exhibit 'nope' for this object; available: ['summary']"]]);
  assert.match(plain(h.script.AGG_EXHIBIT(handle, "summary", "raw", 4))[0][0], /^#AGG! summary has 1 block; block must be/);
  // A number in the cell is program text, as in Excel; only an empty one is neither.
  assert.deepEqual(plain(h.script.AGG_EXHIBITS("")),
                   [["#AGG! expected a handle such as agg.A#4f40714271198d8f, or a DecL program"]]);
  assert.deepEqual(plain(h.script.AGG_EXHIBITS("(2+2)")),
                   [["#AGG! this program is a number or a conversion, not an object; pass a handle from AGG_BUILD or a program that declares an agg, port, sev or distortion"]]);
});

test("AGG_Q answers in the shape of p, and refuses a p outside [0, 1]", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  assert.deepEqual(plain(h.script.AGG_Q(handle, [[0.5], [0.99]])), [[500], [990]]);
  assert.deepEqual(plain(h.script.AGG_Q(handle, 0.9)), [[900]]);
  assert.equal(h.requests.at(-1)!.query.get("snap"), "false");
  assert.deepEqual(plain(h.script.AGG_Q(handle, [[0.5, 1.5]])),
                   [["#AGG! every p must lie between 0 and 1 inclusive; got 1.5"]]);
});

test("AGG_FRAMES lists frames; AGG_FRAMEURL checks the name and returns an absolute URL", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  const frames = plain(h.script.AGG_FRAMES(handle));
  assert.deepEqual(frames[0], ["name", "rows", "columns"]);
  assert.deepEqual(frames.find((r: unknown[]) => r[0] === "stats_df"), ["stats_df", 17, 11]);
  const id = handle.split("#")[1];
  assert.equal(h.script.AGG_FRAMEURL(handle, "stats_df"), `https://agg.mynl.com/v1/objects/${id}/frame/stats_df.csv`);
  assert.equal(h.script.AGG_FRAMEURL(handle, "density_df", "parquet"),
               `https://agg.mynl.com/v1/objects/${id}/frame/density_df.parquet`);
  assert.equal(h.script.AGG_FRAMEURL(handle, "nope"), "#AGG! unknown frame 'nope'; expected one of ['stats_df']");
  assert.equal(h.script.AGG_FRAMEURL(handle, "stats_df", "xlsx"), "#AGG! format must be csv or parquet; got xlsx");
});

// ----------------------------------------------------------------------
// The library
// ----------------------------------------------------------------------

test("AGG_LIBRARY lists, AGG_PROGRAM reads, and the library is fetched once", () => {
  const h = harness();
  const items = fixture("examples-few").items;
  const rows = plain(h.script.AGG_LIBRARY());
  assert.deepEqual(rows[0], ["name", "kind"]);
  assert.deepEqual(rows.slice(1).map((r: unknown[]) => r[0]), items.map((i: { name: string }) => i.name));
  assert.equal(h.script.AGG_PROGRAM("BasicBook"), items[0].decl);
  assert.equal(h.script.AGG_PROGRAM(" DiceOneDie.Sev ", ""), items[2].decl);
  assert.match(plain(h.script.AGG_LIBRARY("BasicBook"))[0][0], /^agg\.BasicBook#[0-9a-f]{16}$/);
  assert.equal(h.count("GET", /^\/v1\/examples$/), 1);
  assert.equal(h.script.AGG_PROGRAM("Nope"), "#AGG! no library entry named Nope; AGG_LIBRARY() lists them");
});

test("an unknown database's refusal is text, and is cached too", () => {
  const h = harness();
  const refusal = "#AGG! unknown database 'nope'; GET /v1/examples/databases lists them";
  assert.deepEqual(plain(h.script.AGG_LIBRARY("", "nope")), [[refusal]]);
  assert.equal(h.script.AGG_PROGRAM("BasicBook", "nope"), refusal);
  assert.equal(h.count("GET", /^\/v1\/examples$/), 1);
});

test("a program evicted from the cache is fetched again", () => {
  const h = harness();
  h.script.AGG_LIBRARY();
  const key = [...h.cache.keys()].find((k) => k.endsWith(":BasicBook")) as string;
  h.cache.delete(key);
  assert.equal(h.script.AGG_PROGRAM("BasicBook"), fixture("examples-few").items[0].decl);
  assert.equal(h.count("GET", /^\/v1\/examples$/), 2);
});

// ----------------------------------------------------------------------
// A lost object, a changed server, passing failures
// ----------------------------------------------------------------------

test("after a restart the recipe rebuilds the object and the read carries on", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  h.restart();
  assert.deepEqual(plain(h.script.AGG_Q(handle, 0.5)), [[500]]);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 2, "one build, one rebuild");
});

test("a rebuild under a different id asks for Recalculate", () => {
  const h = harness();
  const handle = h.script.AGG_BUILD(PROGRAM);
  h.upgrade();
  assert.throws(() => h.script.AGG_Q(handle, 0.5),
                /the server changed since this spreadsheet was saved; use AGG, Recalculate AGG cells, in the menu/);
});

test("a handle with no recipe says so as text", () => {
  const h = harness();
  assert.deepEqual(plain(h.script.AGG_Q("agg.A#0123456789abcdef", 0.5)),
                   [["#AGG! handle unknown to this spreadsheet; recalculate its AGG_BUILD cell"]]);
});

test("a server fault and an unreachable server throw, and are not memoized", () => {
  const h = harness();
  h.on("POST", /^\/v1\/objects$/, () => ({ status: 500, body: null }));
  assert.throws(() => h.script.AGG_BUILD(PROGRAM), /server answered HTTP 500/);
  assert.equal(h.cache.size, 0);
  const g = harness();
  g.unreachable();
  assert.throws(() => g.script.AGG_VERSION(), /server unreachable/);
});

test("a 429 is retried once when Retry-After fits the budget, and never twice", () => {
  const h = harness();
  let calls = 0;
  h.on("GET", /^\/v1\/meta$/, () => (calls++ === 0 ? { status: 429, headers: { "retry-after": "5" } } : undefined));
  assert.match(h.script.AGG_VERSION(), /aggregate_api 9\.9\.9/);
  assert.deepEqual(h.sleeps, [5000]);

  const g = harness();
  g.on("GET", /^\/v1\/meta$/, () => ({ status: 429, headers: { "Retry-After": "5" } }));
  assert.throws(() => g.script.AGG_VERSION(), /rate limited, recalculate in a minute/);
  assert.deepEqual(g.sleeps, [5000], "one retry, then the cell gives up");

  const k = harness();
  k.on("GET", /^\/v1\/meta$/, () => ({ status: 429, headers: { "Retry-After": "25" } }));
  assert.throws(() => k.script.AGG_VERSION(), /rate limited/);
  assert.deepEqual(k.sleeps, [], "a wait past the 20 second budget is not taken");
});

// ----------------------------------------------------------------------
// The generation
// ----------------------------------------------------------------------

test("a new generation empties the memo", () => {
  const h = harness();
  h.script.AGG_BUILD(PROGRAM);
  h.props.set("agg.generation", "1");
  h.script.AGG_BUILD(PROGRAM);
  assert.equal(h.count("POST", /^\/v1\/objects$/), 2);
});
