/**
 * The AGG menu and Recalculate AGG cells, over the built dist/ in a vm.
 *
 * Run: `npm test` from `sheets/`, which builds dist/ first.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { formulaSheet, harness, plain } from "./harness.ts";

test("onOpen adds the AGG menu with its one item", () => {
  const h = harness();
  h.script.onOpen();
  assert.deepEqual(plain(h.menus), [{ name: "AGG", items: [["Recalculate AGG cells", "aggRecalculate"]] }]);
});

test("the formula match finds every AGG call, IMPORTDATA's included, and nothing else", () => {
  const h = harness();
  for (const formula of ["=AGG_BUILD(A2:A20)", "=agg_q(C2, 0.99)", '=IMPORTDATA(AGG_FRAMEURL(C2, "stats_df"))',
                         "=SUM(AGG_Q(C2, D1:D5))", "=AGG_VERSION ()"]) {
    assert.equal(h.script.isAggFormula_(formula), true, formula);
  }
  for (const formula of ["=SUM(A1:A3)", "=MY_AGG_Q(1)", '="AGG_BUILD"', "=AGG_(1)", ""]) {
    assert.equal(h.script.isAggFormula_(formula), false, formula);
  }
});

test("Recalculate bumps the generation, drops the recipes, and rewrites every AGG cell", () => {
  const h = harness();
  h.props.set("agg.generation", "4");
  h.props.set("r:0123456789abcdef", "{}");
  h.props.set("other", "kept");
  h.spreadsheet.sheets = [
    formulaSheet("Example", [["=AGG_BUILD(A2:A20)", "=SUM(A1:A2)"], ["", '=IMPORTDATA(AGG_FRAMEURL(C2, "stats_df"))']], h.log, 2, 3),
    formulaSheet("Other", [["=agg_q(Example!C2, 0.5)"]], h.log),
  ];
  h.script.aggRecalculate();
  assert.equal(h.props.get("agg.generation"), "5");
  assert.ok(!h.props.has("r:0123456789abcdef"));
  assert.equal(h.props.get("other"), "kept");
  assert.deepEqual(h.log, [
    ["clear", "Example", 2, 3],
    ["clear", "Example", 3, 4],
    ["clear", "Other", 1, 1],
    ["flush"],
    ["set", "Example", 2, 3, "=AGG_BUILD(A2:A20)"],
    ["set", "Example", 3, 4, '=IMPORTDATA(AGG_FRAMEURL(C2, "stats_df"))'],
    ["set", "Other", 1, 1, "=agg_q(Example!C2, 0.5)"],
  ]);
});

test("the first Recalculate starts the generation at 1", () => {
  const h = harness();
  h.script.aggRecalculate();
  assert.equal(h.props.get("agg.generation"), "1");
});
