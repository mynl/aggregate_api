/**
 * The template's two tabs, Start here and Example, written by `aggSetUpTemplate`.
 *
 * The author runs it from the Apps Script editor when making or refreshing the
 * template, so the text a user reads is versioned beside the functions it
 * describes. Rerunning it rewrites both tabs and leaves every other tab alone.
 */

const REFERENCE_URL = "https://github.com/mynl/aggregate_api/blob/main/excel/README.md";
const SOURCE_URL = "https://github.com/mynl/aggregate_api";

/** The Example tab's program, a library entry fetched at set-up so its text is the library's. */
const EXAMPLE_ENTRY = "BasicBook";

/** Start here, one row per line: a heading or label in A, its text in B. */
function startHereRows_(): string[][] {
  return [
    ["AGG for Google Sheets", ""],
    ["", "Actuarial loss distributions in cells. Write a DecL program, build it, and read its exhibits, quantiles and frames. The aggregate library computes everything on a public server, agg.mynl.com."],
    ["Your data", "Every program goes to that public server and is kept in its audit log. Use made-up numbers. Never put real data into a program."],
    ["Version", ""],
    ["", ""],
    ["Functions", ""],
    ["AGG_BUILD(decl, [log2], [bs])", "Builds a program, a cell or a range read row by row, and returns its handle, such as agg.BasicBook#4f40714271198d8f."],
    ["AGG_EXHIBITS(handle)", "The exhibits an object can show."],
    ["AGG_EXHIBIT(handle, name, [perspective], [block], [headers])", "One exhibit as values: labels as text, numbers as numbers."],
    ["AGG_Q(handle, p)", "The quantile at each p, in the shape of p."],
    ["AGG_FRAMES(handle)", "The frames an object has, with their rows and columns."],
    ["AGG_FRAMEURL(handle, which, [format])", "The URL of a whole frame, for IMPORTDATA."],
    ["AGG_LIBRARY([name], [database])", "The library's entries, or one entry's handle."],
    ["AGG_PROGRAM(name, [database])", "A library entry's program, to edit and build."],
    ["AGG_VERSION()", "The versions of this copy, the server and the library."],
    ["", ""],
    ["Handles and programs", "Every function that takes a handle also takes a program in its place. Programs combine through text the sheet can see, such as =\"agg A \" & B1 & \" claims sev lognorm 10 cv 1 poisson\". A reference such as agg.BasicBook resolves to library entries only, never to a program built elsewhere in the sheet."],
    ["Refusals", "A program or an argument the server refuses shows #AGG! and the reason, as text, in its cell and in every cell that uses it. Fix the program and they all recover."],
    ["Recalculate", "A passing problem (the server unreachable, a rate limit, a timeout) shows #ERROR!, with the reason on hover. Sheets keeps a cell's result until one of its arguments changes, so use AGG, Recalculate AGG cells, in the menu, which runs every AGG cell again. Use it too when a cell says the server changed."],
    ["Authorization", "The first time you use the AGG menu, Google asks you to authorize this script. It says Google hasn't verified the app: choose Advanced, then the Go to link, then Allow. It is your own copy of the script asking to edit this spreadsheet, show its menu and reach the server. The cells never ask."],
    ["Whole frames", "=IMPORTDATA(AGG_FRAMEURL(handle, \"stats_df\")) loads a frame as a live table. Sheets first asks, in a bar above the grid, to allow access to external data; allow it once. An import holds about 100,000 cells, so take a few columns of a big frame, =IMPORTDATA(AGG_FRAMEURL(handle, \"density_df\") & \"?cols=loss,p_total,S\"), or build it at a smaller log2. -inf arrives as text, and a missing value as an empty cell."],
    ["On a phone", "The cells compute in the Google Sheets app too."],
    ["Your copy", "A copy keeps the version of the script it was made from. For a newer one, make a fresh copy from the template's link."],
    ["More", `The full reference is the Excel add-in's, whose functions these are, with AGG. where Sheets has AGG_: ${REFERENCE_URL}. Source: ${SOURCE_URL}.`],
  ];
}

/** The tab named `name`, emptied, or a new one at `index`. */
function emptySheet_(spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet, name: string, index: number) {
  const existing = spreadsheet.getSheetByName(name);
  if (existing) {
    existing.clear();
    return existing;
  }
  return spreadsheet.insertSheet(name, index);
}

/** Write Start here: the text, then the live version beside its label. */
function writeStartHere_(sheet: GoogleAppsScript.Spreadsheet.Sheet): void {
  const rows = startHereRows_();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows).setWrap(true).setVerticalAlignment("top");
  sheet.getRange(1, 1).setFontSize(14);
  sheet.getRange(1, 1, rows.length, 1).setFontWeight("bold");
  const version = rows.findIndex((row) => row[0] === "Version") + 1;
  sheet.getRange(version, 2).setFormula("=AGG_VERSION()");
  sheet.setColumnWidth(1, 300);
  sheet.setColumnWidth(2, 640);
}

/**
 * Write Example: a library program down column A, and each function over it.
 *
 * The layout leaves room for each spill: the summary is five rows by eight
 * columns, the frames listing about ten rows by three, and stats_df sits to the
 * right of everything.
 */
function writeExample_(sheet: GoogleAppsScript.Spreadsheet.Sheet, program: string): void {
  const lines = program.split("\n");
  sheet.getRange(1, 1).setValue("Program (edit any line)");
  sheet.getRange(2, 1, lines.length, 1).setNumberFormat("@").setValues(lines.map((line) => [line]));
  const labels: [string, string][] = [
    ["C1", "Handle"],
    ["C4", "Summary"],
    ["C12", "p"],
    ["D12", "Quantile"],
    ["F12", "Frames"],
    ["L1", "stats_df, a whole frame"],
  ];
  for (const [cell, label] of labels) sheet.getRange(cell).setValue(label);
  sheet.getRange("C13:C17").setValues([[0.5], [0.9], [0.99], [0.996], [0.999]]);
  const formulas: [string, string][] = [
    ["C2", "=AGG_BUILD(A2:A20)"],
    ["C5", '=AGG_EXHIBIT(C2, "summary")'],
    ["D13", "=AGG_Q(C2, C13:C17)"],
    ["F13", "=AGG_FRAMES(C2)"],
    ["L2", '=IMPORTDATA(AGG_FRAMEURL(C2, "stats_df"))'],
  ];
  for (const [cell, formula] of formulas) sheet.getRange(cell).setFormula(formula);
  sheet.getRangeList(["A1", ...labels.map(([cell]) => cell)]).setFontWeight("bold");
  sheet.setColumnWidth(1, 220);
}

/**
 * Write the template's Start here and Example tabs. Run from the Apps Script editor.
 *
 * Fetches the example program from the library first, so a failure leaves the
 * tabs as they were.
 */
function aggSetUpTemplate(): void {
  const program = libraryProgram_("", EXAMPLE_ENTRY);
  if (program === null) throw new Error(`the library has no ${EXAMPLE_ENTRY}`);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const startHere = emptySheet_(spreadsheet, "Start here", 0);
  writeStartHere_(startHere);
  writeExample_(emptySheet_(spreadsheet, "Example", 1), program);
  spreadsheet.setActiveSheet(startHere);
}
