/**
 * Unit tests for the add-in's pure logic, run by `npm test` (`node --test`).
 *
 * The exhibit fixtures are real payloads from library.agg entries, captured by
 * `uv run --no-sync python dev/capture_excel_fixtures.py` from the repository
 * root. Re-capture after a change to the exhibit IR and read the diff.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  MESSAGES,
  RECIPE_LIMIT,
  Semaphore,
  REFUSAL,
  errorMessage,
  flattenExhibit,
  formatHandle,
  isMissingObject,
  isProgramRefusal,
  isRefusal,
  isSessionId,
  joinDecl,
  localRefusalText,
  memoKey,
  mintSessionId,
  parseHandle,
  probabilities,
  programOrHandle,
  readRecipeTable,
  refusalText,
  rememberRecipe,
  reshape,
  retryAfterSeconds,
} from "../src/functions/core.ts";

function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
}

const rectangular = (rows: unknown[][]) => new Set(rows.map((r) => r.length)).size === 1;

// ----------------------------------------------------------------------
// Handles and programs
// ----------------------------------------------------------------------

test("a handle round trips", () => {
  const text = formatHandle("port", "Capstone.Gross", "4f40714271198d8f");
  assert.equal(text, "port.Capstone.Gross#4f40714271198d8f");
  assert.deepEqual(parseHandle(text), { kind: "port", name: "Capstone.Gross", id: "4f40714271198d8f" });
  assert.deepEqual(parseHandle(`  ${text} `)?.id, "4f40714271198d8f");
});

test("anything that is not a handle parses to null", () => {
  for (const text of ["", "agg.A", "agg.A#123", "agg.A#4F40714271198D8F", "#4f40714271198d8f", 42, null]) {
    assert.equal(parseHandle(text), null, String(text));
  }
});

test("a handle argument is a handle or a program, never both", () => {
  const text = formatHandle("agg", "A", "4f40714271198d8f");
  assert.deepEqual(programOrHandle(text), { handle: { kind: "agg", name: "A", id: "4f40714271198d8f" } });
  assert.deepEqual(programOrHandle("  agg A 2 claims sev lognorm 10 cv 1 poisson "), {
    program: "agg A 2 claims sev lognorm 10 cv 1 poisson",
  });
  // A near miss on the handle grammar is a program, and the server will say so.
  assert.deepEqual(programOrHandle("agg.A#123"), { program: "agg.A#123" });
  for (const text of ["", "   ", 42, null, undefined, true, `${REFUSAL} line 1, col 3: oops`]) {
    assert.equal(programOrHandle(text), null, String(text));
  }
});

test("a refused program becomes #AGG! text, a transient failure does not", () => {
  assert.equal(REFUSAL, "#AGG!");
  const body = { detail: { line: 1, column: 43, message: "Unexpected 'oops'." } };
  const text = refusalText(422, body);
  assert.equal(text, "#AGG! line 1, col 43: Unexpected 'oops'.");
  assert.ok(isRefusal(text));
  assert.ok(isRefusal(`${REFUSAL} anything`));
  for (const value of ["agg A 1 claim dsev [1] fixed", "#VALUE!", "#DECL! gone", "", 42, null]) {
    assert.equal(isRefusal(value), false, String(value));
  }
  for (const status of [400, 404, 422]) assert.ok(isProgramRefusal(status), String(status));
  for (const status of [200, 429, 500, 504]) assert.equal(isProgramRefusal(status), false, String(status));
});

test("an argument the add-in refuses itself reads under the same prefix", () => {
  assert.equal(localRefusalText(MESSAGES.notAHandle), `#AGG! ${MESSAGES.notAHandle}`);
  assert.ok(isRefusal(localRefusalText("every p must lie between 0 and 1 inclusive; got 1.5")));
  // A route's 404 about the object reads the server's own sentence.
  assert.equal(refusalText(404, { detail: "unknown frame 'nope'; expected one of ['density_df']" }),
               "#AGG! unknown frame 'nope'; expected one of ['density_df']");
});

test("a range joins its non-empty cells in reading order", () => {
  assert.equal(joinDecl([["agg A 2 claims"]]), "agg A 2 claims");
  assert.equal(joinDecl([["agg A", "2 claims"], ["", null], ["sev lognorm 10 cv 1", "poisson"]]),
               "agg A\n2 claims\nsev lognorm 10 cv 1\npoisson");
  assert.equal(joinDecl([["  "], [null]]), "");
  assert.equal(joinDecl("agg A 1 claim dsev [1] fixed"), "agg A 1 claim dsev [1] fixed");
});

test("the memo key separates the grid arguments", () => {
  assert.notEqual(memoKey("agg A", 0, 0), memoKey("agg A", 10, 0));
  assert.equal(memoKey("agg A", 10, 0.5), memoKey("agg A", 10, 0.5));
});

test("a minted session id is one the server accepts", () => {
  const id = mintSessionId(new Date("2026-10-16T12:34:56.789Z"), "2f1c8a4e-7b3d-4c9a-8e1f-6d5b4a3c2e10");
  assert.equal(id, "2026-10-16T12:34:56.789Z-2f1c8a4e-7b3d-4c9a-8e1f-6d5b4a3c2e10");
  assert.ok(isSessionId(id));
  assert.ok(!isSessionId("short"));
  assert.ok(!isSessionId("has a space in it"));
  assert.ok(!isSessionId(undefined));
});

// ----------------------------------------------------------------------
// Exhibits
// ----------------------------------------------------------------------

test("summary flattens to a caption, a header and numeric rows", () => {
  const payload = fixture("summary-basicbook");
  const rows = flattenExhibit(payload);
  assert.ok(rectangular(rows));
  assert.equal(rows[0][0], payload.blocks[0].caption);
  assert.deepEqual(rows[1], ["X", "Mean", "SD", "CV", "Skew", "P01", "Median", "P99"]);
  assert.equal(rows[2][0], "Freq");
  assert.equal(rows[2][1], 250);
  // A null raw value (frequency percentiles) is an empty cell, not a dash.
  assert.equal(rows[2][5], "");
  assert.equal(typeof rows[4][1], "number");
});

test("block 1 alone has no caption, and headers can be left off", () => {
  const payload = fixture("summary-basicbook");
  assert.equal(flattenExhibit(payload, 1)[0][0], "X");
  const bare = flattenExhibit(payload, 1, false);
  assert.deepEqual(bare.map((r) => r[0]), ["Freq", "Sev", "Agg"]);
});

test("a rowspan stub label is repeated into the rows it covers", () => {
  const payload = fixture("stats-basicbook");
  const block = payload.blocks[0];
  const first = block.body[0].cells[0];
  assert.ok(first.rowspan > 1, "the fixture should start with a spanned stub");
  const rows = flattenExhibit(payload, 1, false);
  assert.ok(rectangular(rows));
  assert.equal(rows[0].length, block.columns.length);
  for (let i = 0; i < first.rowspan; i++) assert.equal(rows[i][0], first.text, `row ${i}`);
  assert.notEqual(rows[first.rowspan][0], first.text);
  // The second stub level is still its own label on every row.
  assert.equal(rows[1][1], block.body[1].cells[0]);
});

test("several blocks stack, each under its caption, a blank row between", () => {
  const payload = fixture("reins-aggregatestoploss");
  const [one, two] = payload.blocks;
  const rows = flattenExhibit(payload);
  assert.ok(rectangular(rows));
  const width = Math.max(one.columns.length, two.columns.length);
  assert.equal(rows[0].length, width);
  assert.equal(rows[0][0], one.caption);
  const gap = 1 + one.head.length + one.body.length;
  assert.ok(rows[gap].every((cell) => cell === ""), "a blank row separates the blocks");
  assert.equal(rows[gap + 1][0], two.caption);
  assert.equal(rows.length, gap + 2 + two.head.length + two.body.length);
});

test("a colspan header label is repeated across its columns", () => {
  const payload = fixture("reins-aggregatestoploss");
  const rows = flattenExhibit(payload, 1);
  assert.deepEqual(rows[0], ["", "", "occ", "agg", "agg", "agg"]);
  assert.deepEqual(rows[1], ["component", "measure", "Gross", "layer.1", "Ceded", "Net"]);
});

test("a block that does not exist says how many there are", () => {
  const payload = fixture("reins-aggregatestoploss");
  assert.throws(() => flattenExhibit(payload, 3), /reins has 2 blocks; block must be 0 \(all\) or 1 to 2/);
  assert.throws(() => flattenExhibit(payload, -1));
  assert.throws(() => flattenExhibit(payload, 1.5));
});

// ----------------------------------------------------------------------
// Errors
// ----------------------------------------------------------------------

test("a parse error reads line and column", () => {
  const body = { detail: { line: 1, column: 43, message: "Unexpected 'oops'.", caret: "^^^^" } };
  assert.equal(errorMessage(422, body), "line 1, col 43: Unexpected 'oops'.");
});

test("a structured refusal reads its own message", () => {
  const own = { detail: { error: "session_reference", kind: "agg", name: "A",
                          message: "agg.A is one of your own declarations, and this client resolves only library entries." } };
  assert.equal(errorMessage(422, own), own.detail.message);
  const missing = { detail: { error: "recipe_not_found", kind: "agg", name: "ASV.Inner",
                              message: "agg.ASV.Inner is defined in decl-testers, which builds do not read." } };
  assert.equal(errorMessage(422, missing), missing.detail.message);
});

test("the remaining statuses map to fixed messages or the server's words", () => {
  assert.equal(errorMessage(504, { detail: "build timeout" }), MESSAGES.timeout);
  assert.equal(errorMessage(429, "<html>"), MESSAGES.rateLimited);
  assert.equal(errorMessage(422, { detail: "log2 30 exceeds AGGAPI_LOG2_CAP=18" }),
               "log2 30 exceeds AGGAPI_LOG2_CAP=18");
  assert.equal(errorMessage(422, { detail: [{ loc: ["body", "log2"], msg: "Input should be >= 4" }] }),
               "body.log2: Input should be >= 4");
  assert.equal(errorMessage(500, null), "server answered HTTP 500");
});

test("only the cache's own 404 counts as a missing object", () => {
  assert.ok(isMissingObject({ detail: "object 0123456789abcdef not in cache" }));
  assert.ok(!isMissingObject({ detail: "no exhibit 'nope' for this object; available: ['summary']" }));
  assert.ok(!isMissingObject("Not Found"));
});

test("Retry-After is read as seconds or a date, and clamped", () => {
  assert.equal(retryAfterSeconds("5"), 5);
  assert.equal(retryAfterSeconds(null), 10);
  assert.equal(retryAfterSeconds("soon"), 10);
  assert.equal(retryAfterSeconds("0"), 1);
  assert.equal(retryAfterSeconds("3600"), 60);
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(retryAfterSeconds("Fri, 16 Oct 2026 12:00:20 GMT", now), 20);
});

// ----------------------------------------------------------------------
// The recipe table
// ----------------------------------------------------------------------

test("a recipe is recorded newest, and recording again moves it", () => {
  let table = rememberRecipe({}, "aaaaaaaaaaaaaaaa", { decl: "agg A", log2: 0, bs: 0 });
  table = rememberRecipe(table, "bbbbbbbbbbbbbbbb", { decl: "agg B", log2: 10, bs: 0.5 });
  assert.equal(table.bbbbbbbbbbbbbbbb.seq, 2);
  table = rememberRecipe(table, "aaaaaaaaaaaaaaaa", { decl: "agg A", log2: 0, bs: 0 });
  assert.equal(table.aaaaaaaaaaaaaaaa.seq, 3);
  assert.deepEqual(table.bbbbbbbbbbbbbbbb, { decl: "agg B", log2: 10, bs: 0.5, seq: 2 });
});

test("the table holds its limit and drops the oldest", () => {
  let table = {};
  for (let i = 0; i < RECIPE_LIMIT + 3; i++) {
    table = rememberRecipe(table, i.toString(16).padStart(16, "0"), { decl: `agg A${i}`, log2: 0, bs: 0 });
  }
  const ids = Object.keys(table);
  assert.equal(ids.length, RECIPE_LIMIT);
  assert.ok(!("0000000000000000" in table));
  assert.ok(!("0000000000000002" in table));
  assert.ok("0000000000000003" in table);
});

test("a table read from settings keeps only well-formed rows", () => {
  const raw = {
    "0123456789abcdef": { decl: "agg A", log2: 0, bs: 0, seq: 1 },
    "not-an-id": { decl: "agg B", log2: 0, bs: 0, seq: 2 },
    "fedcba9876543210": { decl: 7, log2: 0, bs: 0, seq: 3 },
  };
  assert.deepEqual(Object.keys(readRecipeTable(raw)), ["0123456789abcdef"]);
  assert.deepEqual(readRecipeTable(null), {});
  assert.deepEqual(readRecipeTable("junk"), {});
});

// ----------------------------------------------------------------------
// Quantiles and the request limit
// ----------------------------------------------------------------------

test("probabilities come in reading order and spill back in their shape", () => {
  assert.deepEqual(probabilities(0.5), [0.5]);
  assert.deepEqual(probabilities([[0.5, 0.9], [0.99, 0.999]]), [0.5, 0.9, 0.99, 0.999]);
  const served = fixture("quantiles-basicbook").quantiles.map((row: { q: number }) => row.q);
  assert.deepEqual(reshape(served, [[0.5, 0.99]]), [served]);
  assert.deepEqual(reshape([1, 2, 3, 4], [[0.1], [0.2], [0.3], [0.4]]), [[1], [2], [3], [4]]);
});

test("p takes the closed interval, and anything outside it is refused and named", () => {
  assert.deepEqual(probabilities([[0, 0.5, 1]]), [0, 0.5, 1]);
  for (const bad of [1.5, -0.1, "", "half", null]) {
    assert.throws(() => probabilities([[0.5, bad]]), /between 0 and 1 inclusive; got/, String(bad));
  }
  assert.throws(() => probabilities(1.5), /got 1\.5$/);
});

test("the semaphore never runs more than its limit", async () => {
  const slots = new Semaphore(2);
  let peak = 0;
  const task = async () => {
    peak = Math.max(peak, slots.running);
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  await Promise.all(Array.from({ length: 7 }, () => slots.run(task)));
  assert.equal(peak, 2);
  assert.equal(slots.running, 0);
});
