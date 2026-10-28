/**
 * The AGG functions for Google Sheets: aggregate_api in spreadsheet cells.
 *
 * The Excel add-in's nine functions, named AGG_ where Excel has AGG. because a
 * Sheets function name cannot hold a dot, over the same pure core: `AggCore`,
 * bundled from excel/src/functions/core.ts by build.mjs. This file is the Apps
 * Script and network layer around it. See dev/plan-sheets-template.md.
 *
 * Every cell evaluation is its own Apps Script execution: synchronous, at most
 * 30 seconds, sharing no memory with any other cell. So the state Excel keeps
 * in memory lives in the document instead:
 *
 * - the build memo, in the document cache, keyed by the generation and a
 *   digest of (decl, log2, bs);
 * - the generation, in the document property agg.generation, which the AGG
 *   menu's Recalculate bumps, since a cache can be neither listed nor cleared;
 * - the recipe table, one document property per object id (r:<id>), so cells
 *   writing at the same moment never read, modify and write one shared value;
 * - the library, one cache entry per program plus one for the listing.
 *
 * There is no in-flight sharing: the server coalesces identical builds that
 * arrive together (aggregate_api 1.26.1), and the memo absorbs what follows.
 *
 * A refusal (the program or an argument is wrong) is returned as `#AGG!` text,
 * as in Excel. A passing failure (unreachable, rate limited, timed out, a
 * server fault) throws, which shows #ERROR! with the message on hover. Sheets
 * keeps that error until an argument changes, so AGG, Recalculate AGG cells is
 * the remedy, and the messages say so.
 *
 * Helpers end in an underscore, which Apps Script reads as private: they
 * cannot be called from a cell. Nothing here touches `AggCore` while the
 * script loads, only inside functions, so the order Apps Script loads the
 * files in does not matter.
 */

declare const AggCore: typeof import("../../excel/src/functions/core");
declare const __AGG_CLIENT_VERSION__: string;
declare const __AGG_API_BASE__: string;

type CellValue = import("../../excel/src/functions/core").CellValue;
type Grid = import("../../excel/src/functions/core").Grid;
type Handle = import("../../excel/src/functions/core").Handle;
type LibraryItem = import("../../excel/src/functions/core").LibraryItem;

/** This copy's version: a copied template never updates, so `AGG_VERSION` reports it. */
const CLIENT_VERSION = __AGG_CLIENT_VERSION__;
const BASE_URL = __AGG_API_BASE__;
const SESSION_HEADER = "X-Aggregate-Session";
const GENERATION_KEY = "agg.generation";
const RECIPE_PREFIX = "r:";
/** Six hours, the most CacheService keeps anything. */
const CACHE_SECONDS = 21600;
/**
 * How long a call may spend before giving up on a 429. A custom function has 30
 * seconds in all, so one retry at most, and only when `Retry-After` fits.
 */
const RETRY_BUDGET_MS = 20000;

/** When the running cell started, set by `scalar_` and `rows_`, for the retry budget. */
let callStarted = 0;

/**
 * A refusal, carrying the `#AGG!` text the cell should show.
 *
 * Thrown where the program behind a handle did not build, where the server
 * refused a request about the object, and where an argument is wrong, and
 * turned back into the cell's value by `scalar_` or `rows_`.
 */
class Refusal extends Error {}

/** The messages, worded for Sheets: `AGG_BUILD`, the AGG menu, spreadsheet. */
function messages_() {
  return AggCore.hostMessages(AggCore.SHEETS);
}

/** Throw a `Refusal` for a message this script raised itself. */
function refuse_(message: string): never {
  throw new Refusal(AggCore.localRefusalText(message));
}

/** Run a function that returns one value, turning a refusal into its text. */
function scalar_(work: () => string | number): string | number {
  callStarted = Date.now();
  try {
    return work();
  } catch (error) {
    if (error instanceof Refusal) return error.message;
    throw error;
  }
}

/** Run a spilling function, turning a refusal into a one-cell spill of its text. */
function rows_(work: () => Grid): Grid {
  callStarted = Date.now();
  try {
    return work();
  } catch (error) {
    if (error instanceof Refusal) return [[error.message]];
    throw error;
  }
}

/** Hex SHA-256 of `text`, in the form the session id and the cache keys use. */
function sha256Hex_(text: string): string {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

/**
 * This spreadsheet's session id: `sheets:` and a digest of its id.
 *
 * Stable for a copy and needing no storage. It gives each spreadsheet its own
 * rate-limit budget on the public server, which keys on the header, and keeps
 * the raw spreadsheet id, which grants access when link sharing is on, off the
 * server.
 */
function sessionId_(): string {
  return "sheets:" + sha256Hex_(SpreadsheetApp.getActiveSpreadsheet().getId());
}

/** The memo's generation; Recalculate bumps it, which empties the memo. */
function generation_(): string {
  return PropertiesService.getDocumentProperties().getProperty(GENERATION_KEY) || "0";
}

/** A response header by name, whatever case the server sent it in. */
function header_(response: GoogleAppsScript.URL_Fetch.HTTPResponse, name: string): string | null {
  const headers = response.getHeaders() as Record<string, unknown>;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return String(headers[key]);
  }
  return null;
}

interface Reply {
  status: number;
  body: unknown;
}

/**
 * One request to the API, retrying a 429 once when the wait fits the budget.
 *
 * @returns The status and the parsed body. Only a network failure throws (as
 *   "server unreachable"); every HTTP status is the caller's to read.
 */
function request_(method: "get" | "post", path: string, payload?: unknown): Reply {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method,
    muteHttpExceptions: true,
    headers: { [SESSION_HEADER]: sessionId_() },
  };
  if (payload !== undefined) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }
  const started = callStarted || Date.now();
  for (let attempt = 0; ; attempt++) {
    let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
    try {
      response = UrlFetchApp.fetch(BASE_URL + path, options);
    } catch (error) {
      throw new Error(messages_().unreachable);
    }
    const status = response.getResponseCode();
    if (status === 429 && attempt === 0) {
      const wait = AggCore.retryAfterSeconds(header_(response, "Retry-After")) * 1000;
      if (Date.now() - started + wait <= RETRY_BUDGET_MS) {
        Utilities.sleep(wait);
        continue;
      }
    }
    const text = response.getContentText();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // A proxy's HTML error page: keep the text for the message.
    }
    return { status, body };
  }
}

/** Throw the passing failure a status means. */
function fail_(reply: Reply): never {
  throw new Error(AggCore.errorMessage(reply.status, reply.body));
}

/** POST a build that resolves library entries only. */
function postBuild_(decl: string, log2: number, bs: number): Reply {
  const payload: Record<string, unknown> = { decl, library_references_only: true };
  if (log2) payload.log2 = log2;
  if (bs) payload.bs = bs;
  return request_("post", "/v1/objects", payload);
}

/** Record how `id` was built, so a handle saved in a cell survives a restart. */
function rememberRecipe_(id: string, decl: string, log2: number, bs: number): void {
  try {
    PropertiesService.getDocumentProperties().setProperty(
      RECIPE_PREFIX + id,
      JSON.stringify({ decl, log2, bs })
    );
  } catch (error) {
    // Over the 9 KB value or the 500 KB store limit. The handle still works
    // until the server loses the object, and Recalculate empties the store.
  }
}

/** The recipe recorded for `id`, or null. */
function recipe_(id: string): { decl: string; log2: number; bs: number } | null {
  const raw = PropertiesService.getDocumentProperties().getProperty(RECIPE_PREFIX + id);
  if (!raw) return null;
  try {
    const row = JSON.parse(raw);
    if (typeof row.decl === "string" && typeof row.log2 === "number" && typeof row.bs === "number") {
      return { decl: row.decl, log2: row.log2, bs: row.bs };
    }
  } catch {
    // A hand edit or a damaged value is no recipe.
  }
  return null;
}

/**
 * Build a program once per generation: the memo, else a POST.
 *
 * A refusal is memoized like a handle: the same program draws the same refusal
 * until it is edited, which changes the key. A passing failure is not.
 */
function buildOnce_(program: string, log2: number, bs: number): string | number {
  const cache = CacheService.getDocumentCache();
  const key = `b:${generation_()}:${sha256Hex_(AggCore.memoKey(program, log2, bs))}`;
  const known = cache ? cache.get(key) : null;
  if (known !== null) return JSON.parse(known);
  const reply = postBuild_(program, log2, bs);
  let value: string | number;
  if (AggCore.isProgramRefusal(reply.status)) {
    value = AggCore.refusalText(reply.status, reply.body);
  } else if (reply.status !== 200) {
    return fail_(reply);
  } else {
    const made = reply.body as {
      kind: string; name?: string; id?: string; value?: number; text?: string;
    };
    if (made.kind === "value") {
      value = made.value as number;
    } else if (made.kind === "text") {
      // A conversion statement answers with text, the cell value as it is.
      value = made.text as string;
    } else {
      value = AggCore.formatHandle(made.kind, made.name ?? "", made.id as string);
      rememberRecipe_(made.id as string, program, log2, bs);
    }
  }
  if (cache) cache.put(key, JSON.stringify(value), CACHE_SECONDS);
  return value;
}

/**
 * The handle a `handle` argument names: as given, or built from the program it holds.
 *
 * A program takes the default grid and goes through the same path as
 * AGG_BUILD, so the cell then behaves as if it held the handle AGG_BUILD would
 * have returned.
 */
function handleOf_(handleCells: unknown): Handle {
  const text = AggCore.joinDecl(handleCells as CellValue);
  if (AggCore.isRefusal(text)) throw new Refusal(text);
  const arg = AggCore.programOrHandle(text);
  if (!arg) return refuse_(messages_().notAHandle);
  if ("handle" in arg) return arg.handle;
  const built = buildOnce_(arg.program, 0, 0);
  if (typeof built === "string" && AggCore.isRefusal(built)) throw new Refusal(built);
  const made = AggCore.parseHandle(built);
  if (!made) return refuse_(messages_().programIsValue);
  return made;
}

/**
 * GET a route on the object a handle names, rebuilding it once if the server
 * has lost it.
 *
 * Excel's `readFrom`, ported. A 404 saying the object is not in cache means it
 * was evicted or the server restarted, so the recipe is posted again: the same
 * id back means the same object and the GET is retried once; a different id
 * means the server changed, and the cell asks for Recalculate. Unlike Excel,
 * nothing is cleared here, because Recalculate bumps the generation itself.
 * Any other 4xx is about the request and comes back as `#AGG!` text.
 */
function readFrom_(handle: Handle, path: (id: string) => string): unknown {
  let reply = request_("get", path(handle.id));
  if (reply.status === 404 && AggCore.isMissingObject(reply.body)) {
    const recipe = recipe_(handle.id);
    if (!recipe) return refuse_(messages_().unknownHandle);
    const rebuilt = postBuild_(recipe.decl, recipe.log2, recipe.bs);
    if (AggCore.isProgramRefusal(rebuilt.status)) {
      throw new Refusal(AggCore.refusalText(rebuilt.status, rebuilt.body));
    }
    if (rebuilt.status !== 200) return fail_(rebuilt);
    if ((rebuilt.body as { id?: string }).id !== handle.id) {
      throw new Error(messages_().upgraded);
    }
    reply = request_("get", path(handle.id));
  }
  if (AggCore.isProgramRefusal(reply.status)) {
    throw new Refusal(AggCore.refusalText(reply.status, reply.body));
  }
  if (reply.status !== 200) return fail_(reply);
  return reply.body;
}

/** `readFrom_` for a handle argument, built first when it holds a program. */
function readObject_(handleCells: unknown, path: (id: string) => string): unknown {
  return readFrom_(handleOf_(handleCells), path);
}

/** An argument as trimmed text: an empty cell and an omitted argument are both "". */
function text_(value: unknown): string {
  return value === undefined || value === null ? "" : String(value).trim();
}

/** A grid argument (`log2`, `bs`): 0, meaning the library chooses, when empty. */
function gridNumber_(value: unknown, name: string): number {
  if (value === undefined || value === null || value === "") return 0;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return refuse_(`${name} must be a number; got ${String(value)}`);
  return number;
}

// ----------------------------------------------------------------------
// The library
// ----------------------------------------------------------------------

/** A cache key for the library: the listing under name "", each program under its name. */
function libraryKey_(generation: string, database: string, name: string): string {
  return `l:${generation}:${database}:${name}`;
}

/**
 * Fetch the library and cache it one entry per program.
 *
 * About 150 KB for the default library, over CacheService's 100 KB per value,
 * so it is cached in pieces: the `name | kind` listing under one key and each
 * program under its own. An unknown database's 422 is cached as its refusal,
 * so a sheet of cells naming the same wrong stem asks once.
 */
function fetchLibrary_(database: string): LibraryItem[] {
  const path = database ? `/v1/examples?database=${encodeURIComponent(database)}` : "/v1/examples";
  const reply = request_("get", path);
  const cache = CacheService.getDocumentCache();
  const generation = generation_();
  if (AggCore.isProgramRefusal(reply.status)) {
    const refusal = AggCore.refusalText(reply.status, reply.body);
    if (cache) cache.put(libraryKey_(generation, database, ""), JSON.stringify({ refusal }), CACHE_SECONDS);
    throw new Refusal(refusal);
  }
  if (reply.status !== 200) return fail_(reply);
  const items = ((reply.body as { items?: LibraryItem[] }).items ?? []).map(({ name, kind, decl }) => ({
    name,
    kind,
    decl,
  }));
  if (cache) {
    const entries: Record<string, string> = {
      [libraryKey_(generation, database, "")]: JSON.stringify({
        items: items.map(({ name, kind }) => ({ name, kind })),
      }),
    };
    for (const item of items) entries[libraryKey_(generation, database, item.name)] = item.decl;
    try {
      cache.putAll(entries, CACHE_SECONDS);
    } catch (error) {
      // A cache that refuses only makes the next cell fetch again.
    }
  }
  return items;
}

/** The library's `name | kind` listing, from the cache or a fetch. */
function libraryListing_(database: string): { name: string; kind: string }[] {
  const cache = CacheService.getDocumentCache();
  const hit = cache ? cache.get(libraryKey_(generation_(), database, "")) : null;
  if (hit === null) return fetchLibrary_(database);
  const listing = JSON.parse(hit) as { items?: { name: string; kind: string }[]; refusal?: string };
  if (listing.refusal) throw new Refusal(listing.refusal);
  return listing.items ?? [];
}

/** The program of the entry named exactly `name`, or null when no entry has that name. */
function libraryProgram_(database: string, name: unknown): string | null {
  const entry = AggCore.libraryEntry(libraryListing_(database) as LibraryItem[], name);
  if (!entry) return null;
  const cache = CacheService.getDocumentCache();
  const decl = cache ? cache.get(libraryKey_(generation_(), database, entry.name)) : null;
  if (decl !== null) return decl;
  return AggCore.libraryEntry(fetchLibrary_(database), entry.name)?.decl ?? null;
}

// ----------------------------------------------------------------------
// The functions
// ----------------------------------------------------------------------

/**
 * The versions of this copy of AGG for Sheets, the server and the aggregate library.
 *
 * @return {string} AGG for Sheets, aggregate_api and aggregate versions.
 * @customfunction
 */
function AGG_VERSION(): string | number {
  return scalar_(() => {
    const reply = request_("get", "/v1/meta");
    if (reply.status !== 200) return fail_(reply);
    const meta = reply.body as { version?: string; aggregate_version?: string };
    return `AGG for Sheets ${CLIENT_VERSION}; aggregate_api ${meta.version}, aggregate ${meta.aggregate_version}`;
  });
}

/**
 * Build a DecL program and return its handle. References resolve to library entries only.
 *
 * @param {string|Array<Array<string>>} decl The program: a cell, or a range whose non-empty cells join row by row.
 * @param {number} log2 Optional. log2 of the grid size; omit to let the library choose.
 * @param {number} bs Optional. Bucket size; omit to let the library choose.
 * @return {string} A handle such as agg.A#4f40714271198d8f, the number a program such as (2+2) means, or #AGG! and the reason the server refused the program.
 * @customfunction
 */
function AGG_BUILD(decl: unknown, log2?: unknown, bs?: unknown): string | number {
  return scalar_(() => {
    const program = AggCore.joinDecl(decl as CellValue);
    if (!program) return AggCore.localRefusalText(messages_().emptyProgram);
    if (AggCore.isRefusal(program)) return program;
    return buildOnce_(program, gridNumber_(log2, "log2"), gridNumber_(bs, "bs"));
  });
}

/**
 * The exhibits an object can show.
 *
 * @param {string|Array<Array<string>>} handle A handle from AGG_BUILD, or a DecL program.
 * @return One row per exhibit: name, title, perspectives. #AGG! and the reason if the program or the argument is refused.
 * @customfunction
 */
function AGG_EXHIBITS(handle: unknown): Grid {
  return rows_(() => {
    const body = readObject_(handle, (id) => `/v1/objects/${id}/exhibits`);
    const items =
      (body as { exhibits?: { name: string; title: string; perspectives: string[] }[] }).exhibits ?? [];
    return [
      ["name", "title", "perspectives"],
      ...items.map((e) => [e.name, e.title, e.perspectives.join(", ")]),
    ];
  });
}

/**
 * One exhibit, as values.
 *
 * @param {string|Array<Array<string>>} handle A handle from AGG_BUILD, or a DecL program.
 * @param {string} name The exhibit, such as summary; AGG_EXHIBITS lists them.
 * @param {string} perspective Optional. raw (the default) or insurer.
 * @param {number} block Optional. 0 (the default) stacks every block under its caption; k returns block k alone.
 * @param {boolean} headers Optional. Whether to include the header rows. Default TRUE.
 * @return The exhibit's rows: labels as text, values as numbers. #AGG! and the reason if the program or an argument is refused.
 * @customfunction
 */
function AGG_EXHIBIT(
  handle: unknown,
  name: unknown,
  perspective?: unknown,
  block?: unknown,
  headers?: unknown
): Grid {
  return rows_(() => {
    const view = encodeURIComponent(text_(perspective) || "raw");
    const exhibit = encodeURIComponent(text_(name));
    const body = readObject_(handle, (id) => `/v1/objects/${id}/exhibit/${exhibit}?perspective=${view}`);
    const which = block === undefined || block === null || block === "" ? 0 : Number(block);
    const withHeaders = headers === undefined || headers === null || headers === "" ? true : Boolean(headers);
    try {
      return AggCore.flattenExhibit(body, which, withHeaders);
    } catch (error) {
      return refuse_((error as Error).message);
    }
  });
}

/**
 * Quantiles of the object's total loss.
 *
 * @param {string|Array<Array<string>>} handle A handle from AGG_BUILD, or a DecL program.
 * @param {number|Array<Array<number>>} p A probability, or a range of them, each between 0 and 1 inclusive.
 * @return The exact quantile at each p, in the shape of p. #AGG! and the reason if the program or a p is refused.
 * @customfunction
 */
function AGG_Q(handle: unknown, p: unknown): Grid {
  return rows_(() => {
    let values: number[];
    try {
      values = AggCore.probabilities(p as CellValue);
    } catch (error) {
      return refuse_((error as Error).message);
    }
    const body = readObject_(handle, (id) => `/v1/objects/${id}/quantiles?snap=false&p=${values.join(",")}`);
    const rows = (body as { quantiles?: { q: number }[] }).quantiles ?? [];
    return AggCore.reshape(
      rows.map((row) => row.q),
      p as CellValue
    );
  });
}

/**
 * The frames an object has, with their shapes.
 *
 * @param {string|Array<Array<string>>} handle A handle from AGG_BUILD, or a DecL program.
 * @return One row per frame: name, rows, columns. #AGG! and the reason if the program is refused.
 * @customfunction
 */
function AGG_FRAMES(handle: unknown): Grid {
  return rows_(() => AggCore.frameRows(readObject_(handle, (id) => `/v1/objects/${id}/frames`)));
}

/**
 * The URL of a whole frame, for IMPORTDATA: =IMPORTDATA(AGG_FRAMEURL(handle, "stats_df")).
 *
 * @param {string|Array<Array<string>>} handle A handle from AGG_BUILD, or a DecL program.
 * @param {string} which The frame, such as stats_df; AGG_FRAMES lists them.
 * @param {string} format Optional. csv (the default) or parquet.
 * @return {string} The absolute URL of the frame. #AGG! and the reason if the program, the frame name or the format is refused.
 * @customfunction
 */
function AGG_FRAMEURL(handle: unknown, which: unknown, format?: unknown): string | number {
  return scalar_(() => {
    let kind: string;
    try {
      kind = AggCore.frameFormat(format);
    } catch (error) {
      return refuse_((error as Error).message);
    }
    const frame = text_(which);
    const made = handleOf_(handle);
    // Ask for the shape first: an unknown name then reads the server's list of
    // frames here, rather than a URL that fails only inside IMPORTDATA.
    readFrom_(made, (id) => `/v1/objects/${id}/frame/${encodeURIComponent(frame)}/shape`);
    return AggCore.frameDownloadUrl(BASE_URL, made.id, frame, kind);
  });
}

/**
 * A library entry's handle, or the whole library as name and kind.
 *
 * @param {string} name Optional. A library entry, such as Capstone.Gross; omit to list every entry.
 * @param {string} database Optional. A database stem from the server's listing; omit for the default library.
 * @return With name, the entry's handle, built as AGG_BUILD of its program would be; without, one row per entry: name, kind. #AGG! and the reason if the entry, the database or the program is refused.
 * @customfunction
 */
function AGG_LIBRARY(name?: unknown, database?: unknown): Grid {
  return rows_(() => {
    const stem = text_(database);
    if (text_(name) === "") return AggCore.libraryRows(libraryListing_(stem) as LibraryItem[]);
    const decl = libraryProgram_(stem, name);
    if (decl === null) return refuse_(AggCore.noLibraryEntry(name, AggCore.SHEETS));
    // The program's text, not the `kind.Name` reference, so the memo and the
    // recipe table apply, and an entry from another database builds too when
    // it is self-contained.
    return [[buildOnce_(decl, 0, 0)]];
  });
}

/**
 * A library entry's DecL program, as its file spells it.
 *
 * @param {string} name A library entry, such as BasicBook; AGG_LIBRARY() lists them.
 * @param {string} database Optional. A database stem from the server's listing; omit for the default library.
 * @return {string} The program's text, newlines kept, ready to edit and pass to AGG_BUILD. #AGG! and the reason if the entry or the database is refused.
 * @customfunction
 */
function AGG_PROGRAM(name: unknown, database?: unknown): string | number {
  return scalar_(() => {
    const decl = libraryProgram_(text_(database), name);
    if (decl === null) return refuse_(AggCore.noLibraryEntry(name, AggCore.SHEETS));
    return decl;
  });
}
