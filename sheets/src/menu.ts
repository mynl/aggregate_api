/**
 * The AGG menu, and Recalculate AGG cells, Sheets' stand-in for Ctrl+Alt+F9.
 *
 * Sheets keeps a custom function's result for as long as its arguments are
 * unchanged, an #ERROR! included, and has no key that recalculates every cell.
 * The spike (dev/plan-sheets-template.md, item 4) found that clearing a cell,
 * flushing, and writing its formula back makes Sheets evaluate it afresh, which
 * is what Recalculate does to every AGG cell. It also bumps the generation,
 * which empties the build memo and the library cache, and deletes the recipe
 * table, which the cells rewrite as they recompute.
 *
 * Recalculate writes to the sheet, so the first click shows Google's consent
 * screen. The cells never do.
 */

/** A formula that calls an AGG function, including =IMPORTDATA(AGG_FRAMEURL(...)). */
const AGG_FORMULA = /\bAGG_[A-Z]+\s*\(/i;

/** Add the AGG menu. A simple trigger, which needs no authorization. */
function onOpen(): void {
  SpreadsheetApp.getUi().createMenu("AGG").addItem("Recalculate AGG cells", "aggRecalculate").addToUi();
}

/** Whether a cell's formula calls an AGG function. */
function isAggFormula_(formula: string): boolean {
  return AGG_FORMULA.test(formula);
}

/**
 * Every cell on every sheet whose formula calls an AGG function.
 *
 * A spilled result's formula is in its top left cell only, so the spill goes
 * and comes back with it.
 */
function aggCells_(
  spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet
): { range: GoogleAppsScript.Spreadsheet.Range; formula: string }[] {
  const cells: { range: GoogleAppsScript.Spreadsheet.Range; formula: string }[] = [];
  for (const sheet of spreadsheet.getSheets()) {
    const data = sheet.getDataRange();
    const top = data.getRow();
    const left = data.getColumn();
    data.getFormulas().forEach((row, i) =>
      row.forEach((formula, j) => {
        if (formula && isAggFormula_(formula)) {
          cells.push({ range: sheet.getRange(top + i, left + j), formula });
        }
      })
    );
  }
  return cells;
}

/** The menu item: empty the memo and the recipe table, then run every AGG cell again. */
function aggRecalculate(): void {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty(GENERATION_KEY, String((Number(generation_()) || 0) + 1));
  for (const key of props.getKeys()) {
    if (key.startsWith(RECIPE_PREFIX)) props.deleteProperty(key);
  }
  const cells = aggCells_(SpreadsheetApp.getActiveSpreadsheet());
  for (const { range } of cells) range.clearContent();
  SpreadsheetApp.flush();
  for (const { range, formula } of cells) range.setFormula(formula);
}
