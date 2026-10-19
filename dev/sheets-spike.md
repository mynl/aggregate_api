# Sheets spike: what Apps Script allows a custom function

Step 1 of `dev/plan-sheets-template.md` ([spike]). Written 2026-10-18 for the author to run in a scratch Google Sheet. It answers the plan's seven **[spike]** questions, plus one cheap extra (item 8) that the session id design rests on. Nothing here is committed code; the answers go in the plan's Execution log, and the design changes only where the plan names a fallback.

**Data.** The probe posts only `agg Dice dfreq [3] dsev [1:6]` and `agg Spike 5 claims sev lognorm 10 cv 1 poisson` to `https://agg.mynl.com`, and reads `/v1/meta`. No real data, nothing else.

## Set up (once, about five minutes)

1. Create a blank Google Sheet named "AGG spike" in the account that will own the template.
2. Extensions, Apps Script. Delete the starter `Code.gs` contents and paste the probe below.
3. Project Settings (gear), tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace it with the manifest below. These are the three scopes the plan's template will ask for, so the consent screens seen here are the real ones.
4. Save. Back in the sheet, reload the tab so `onOpen` adds the **Spike** menu.

### appsscript.json

```json
{
  "timeZone": "America/New_York",
  "runtimeVersion": "V8",
  "exceptionLogging": "STACKDRIVER",
  "oauthScopes": [
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

### Code.gs

```js
const BASE = "https://agg.mynl.com";
const PROGRAM = "agg Dice dfreq [3] dsev [1:6]";
// Item 5 needs a program that honors log2. Dice is exact on 32 buckets, so the
// library ignores the requested log2 and every Dice frame has 32 rows.
const FRAME_PROGRAM = "agg Spike 5 claims sev lognorm 10 cv 1 poisson";

/** Item 1. @customfunction */
function SPIKE_FETCH() {
  const reply = UrlFetchApp.fetch(BASE + "/v1/meta", { muteHttpExceptions: true });
  return reply.getResponseCode() + " " + JSON.parse(reply.getContentText()).version;
}

/** Item 2. @customfunction */
function SPIKE_PROP(tag) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty("spike:" + tag, new Date().toISOString());
  return "wrote " + props.getProperty("spike:" + tag);
}

/** Item 3, the writer. @customfunction */
function SPIKE_CACHE_PUT(value) {
  CacheService.getDocumentCache().put("spike", String(value), 600);
  return "put " + value;
}

/** Item 3, the reader; change its argument to re-run it. @customfunction */
function SPIKE_CACHE_GET(trigger) {
  return CacheService.getDocumentCache().get("spike") ?? "(miss)";
}

/** Item 4. Fails while the flag is on. @customfunction */
function SPIKE_FLAKY(x) {
  if (PropertiesService.getScriptProperties().getProperty("spike:fail") === "yes") {
    throw new Error("spike: deliberate failure");
  }
  return "ok " + new Date().toISOString();
}

/** Item 5: the density_df CSV URL at a given log2. @customfunction */
function SPIKE_FRAME_URL(log2) {
  const reply = UrlFetchApp.fetch(BASE + "/v1/objects", {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ decl: FRAME_PROGRAM, log2: log2, library_references_only: true }),
  });
  const id = JSON.parse(reply.getContentText()).id;
  return BASE + "/v1/objects/" + id + "/frame/density_df.csv";
}

/** Item 8: the session id the plan derives, from a custom function. @customfunction */
function SPIKE_SESSION() {
  const id = SpreadsheetApp.getActiveSpreadsheet().getId();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, id);
  return "sheets:" + digest.map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Spike")
    .addItem("Rewrite the selected cell", "spikeRewrite")
    .addItem("Flaky: fail on", "spikeFailOn")
    .addItem("Flaky: fail off", "spikeFailOff")
    .addItem("Frame sizes to the log", "spikeFrameSizes")
    .addToUi();
}

// What the plan's Recalculate does to every AGG cell: clear, flush, write back.
function spikeRewrite() {
  const cell = SpreadsheetApp.getActiveRange();
  const formula = cell.getFormula();
  cell.clearContent();
  SpreadsheetApp.flush();
  cell.setFormula(formula || "=SPIKE_FETCH()");
}

function spikeFailOn() { PropertiesService.getScriptProperties().setProperty("spike:fail", "yes"); }
function spikeFailOff() { PropertiesService.getScriptProperties().setProperty("spike:fail", "no"); }

function spikeFrameSizes() {
  for (const log2 of [13, 16]) {
    const url = SPIKE_FRAME_URL(log2);
    const t0 = Date.now();
    const body = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContent();
    Logger.log("log2 %s: %s bytes in %s ms", log2, body.length, Date.now() - t0);
  }
}
```

## Checklist

Record each answer in the plan's **Execution log** (or paste them to Claude, who will). Exact error text matters more than a summary.

1. **UrlFetch from a cell in a fresh copy, second account** (fact 6). Put `=SPIKE_FETCH()` in A1 of this sheet first and confirm it shows `200 1.26.1` or later. Then Share, anyone with the link can view, and from a **second** Google account that has never opened this script (use an incognito window signed in to that account only; a browser signed in to several accounts sends `/copy` to the default one), open `https://docs.google.com/spreadsheets/d/<id>/copy`, make a copy, and look at A1 in the copy before touching any menu. Computes, or what does the cell (and its hover) say? If it fails, select A1 and run Spike, Rewrite the selected cell in the copy, accept the consent, and say whether A1 then computes.
   - Answer:
2. **A custom function writing a document property** (fact 5). `=SPIKE_PROP("a")`. Shows `wrote <timestamp>`, or the error text?
   - Answer:
3. **Document cache shared across cells** (fact 5). B1 `hello`, A3 `=SPIKE_CACHE_PUT(B1)`, A4 `=SPIKE_CACHE_GET(C1)`. C1 is only a trigger: a custom function re-runs when an argument changes, and the cache is invisible to Sheets, so typing in C1 is how A4 is made to look again. After A3 shows `put hello`, type anything in C1 so A4 re-runs. Does A4 show `hello` or `(miss)`? Change B1 to `world`, then C1 again: does A4 follow?
   - Answer:
4. **Does a thrown error stick** (fact 8). Spike, Flaky: fail on. Enter `=SPIKE_FLAKY(1)` in A6: expect `#ERROR!` with "spike: deliberate failure" on hover. Spike, Flaky: fail off. Now (a) reload the tab: does A6 recompute to `ok ...` or stay `#ERROR!`? (b) If it stays, check again after an hour. (c) Edit A6's argument to 2: recovers? (d) Make a fresh stuck cell if reload cleared them, select it, and run Spike, Rewrite the selected cell, which is exactly what Recalculate will do: recovers?
   - Answer:
5. **IMPORTDATA of a big frame** (fact 11). Spike, Frame sizes to the log, then Extensions, Apps Script, Executions (or View, Logs) for the byte counts and times at log2 13 and 16. Then in a new tab, A1 `=IMPORTDATA(SPIKE_FRAME_URL(13))`; in another, the same with 16. Loads, how long, or what error? Scan a few columns for how `inf` or `-inf` arrives (text, number, or not present in this frame).
   - Answer, log2 13:
   - Answer, log2 16:
6. **Consent screens under the three scopes** (fact 6, the plan's Recalculate). Not the orange bar over the grid (that is Sheets' warning about IMPORTDATA). The first time you ran a Spike menu item, a pop-up said "Authorization required" and led through an account chooser to Google's own pages. What did they list, and was there a "Google hasn't verified this app" page? Screenshot or verbatim text, please; the Start here tab will quote it.
   - Answer:
7. **Phone** (the plan's Start here line). Open the sheet in the Google Sheets app on a phone. Does A1 (`=SPIKE_FETCH()`) compute? Does a freshly typed `=SPIKE_FETCH()` in a new cell compute?
   - Answer:
8. **Extra: the session id from a cell.** `=SPIKE_SESSION()`. Shows `sheets:` and 64 hex characters, or an error? (The plan derives the session id this way; a custom function may only read, and `getId()` should be a read.)
   - Answer:

When done, delete the scratch sheet or keep it for the template; nothing in it is reused by the build.
