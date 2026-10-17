/**
 * The add-in's pure logic: no Office.js, no network.
 *
 * Everything the custom functions decide without asking Excel or the server
 * lives here, so `node --test` can cover it directly (`test/core.test.ts`).
 * Node runs this file by stripping its types, so it uses only erasable
 * TypeScript: no enums, namespaces or parameter properties, and no imports.
 */

/** One cell value as Excel hands it to a function. */
export type CellValue = string | number | boolean | null | undefined;

/** What a function spills: every row the same length. */
export type Grid = (string | number | boolean)[][];

/** The three parts of a handle, `kind.Name#id`. */
export interface Handle {
  kind: string;
  name: string;
  id: string;
}

/** What the recipe table holds per object id. */
export interface Recipe {
  decl: string;
  log2: number;
  bs: number;
  /** Insertion order, so the table drops its oldest entry first. */
  seq: number;
}

export type RecipeTable = Record<string, Recipe>;

/** How many recipes a workbook keeps, oldest dropped first. */
export const RECIPE_LIMIT = 500;

/** How many requests the add-in keeps in flight at once. */
export const MAX_IN_FLIGHT = 2;

/** How many times a 429 is retried before the cell gives up. */
export const RATE_LIMIT_RETRIES = 3;

export const MESSAGES = {
  unreachable: "server unreachable",
  notAHandle: "expected a handle such as agg.A#4f40714271198d8f, or a DecL program",
  programIsValue:
    "this program is a number, not an object; pass a handle from AGG.BUILD or a program that declares an agg, port, sev or distortion",
  unknownHandle: "handle unknown to this workbook; recalculate its AGG.BUILD cell",
  upgraded:
    "the server changed since this workbook was saved; press Ctrl+Alt+F9 to recalculate every cell",
  timeout: "build timed out; lower log2 or simplify the program",
  rateLimited: "rate limited, recalculate in a minute",
  emptyProgram: "the program is empty",
};

/**
 * The prefix of the text a cell holds when its program or an argument was refused.
 *
 * The author turned off Excel's error indicators, and a `#VALUE!` cell's
 * message shows only on hover, so a parse error was unreadable. The reason is
 * returned as the cell's value instead, under a prefix that reads like an Excel
 * error and that no DecL program or handle starts with, so the text is
 * recognized wherever it flows next. One prefix for every readable refusal: a
 * program the server refused, a route's 4xx, a bad `p`, a block past the
 * exhibit's last, an argument that is neither a handle nor a program. Only a
 * transient failure (unreachable, rate limited, timed out, server fault) and
 * the recalculate instruction stay Excel errors, since a recalculation can
 * clear them and dependents must not compute on them. `#DECL!` was the prefix
 * for one unreleased day (1.21.0) and nothing is kept for it.
 */
export const REFUSAL = "#AGG!";

const HANDLE = /^([a-z]+)\.(.+)#([0-9a-f]{16})$/;
const SESSION_ID = /^[A-Za-z0-9:.\-_]{8,200}$/;
const MISSING_OBJECT = /^object [0-9a-f]{16} not in cache$/;

/**
 * A handle for the cell: DecL's own reference syntax plus the server's id.
 *
 * @param kind The object kind the server reported, such as `agg` or `port`.
 * @param name The object's name.
 * @param id The server's 16 hex object id.
 */
export function formatHandle(kind: string, name: string, id: string): string {
  return `${kind}.${name}#${id}`;
}

/**
 * Read a handle back out of a cell, or `null` when the cell holds something else.
 *
 * The id is the 16 hex characters after the last `#`; everything before the
 * first dot is the kind.
 */
export function parseHandle(text: unknown): Handle | null {
  if (typeof text !== "string") return null;
  const match = HANDLE.exec(text.trim());
  return match ? { kind: match[1], name: match[2], id: match[3] } : null;
}

/**
 * Read a `handle` argument as a handle or as a DecL program.
 *
 * Every function that takes a handle takes a program in its place and builds
 * it with the default grid, so `=AGG.Q(A1, 0.99)` works with the program itself
 * in A1 and Excel tracks the dependency. A string that is not a handle is a
 * program; anything else (a number, an empty cell) is neither.
 */
export function programOrHandle(text: unknown): { handle: Handle } | { program: string } | null {
  const handle = parseHandle(text);
  if (handle) return { handle };
  if (typeof text !== "string" || !text.trim() || isRefusal(text)) return null;
  return { program: text.trim() };
}

/** Whether a cell value is the text of a refusal. */
export function isRefusal(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(REFUSAL);
}

/**
 * Whether a build's status means the program itself was refused.
 *
 * A refusal (a parse error, an unknown reference, a grid over the cap) is
 * about the program and is returned as text for the author to read. A rate
 * limit, a timeout or a server fault is about the moment, so it stays an Excel
 * error that a recalculation can clear.
 */
export function isProgramRefusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/** The cell text for a refusal the add-in raises itself: the prefix and the message. */
export function localRefusalText(message: string): string {
  return `${REFUSAL} ${message}`;
}

/** The cell text for a program or request the server refused: the prefix and its reason. */
export function refusalText(status: number, body: unknown): string {
  return localRefusalText(errorMessage(status, body));
}

/**
 * Join a cell or a range into one program.
 *
 * Non-empty cells join with newlines in reading order (row by row). A single
 * newline continues a statement in DecL, so a program laid out one clause per
 * cell reads as one statement, which is what the server collapses it to anyway.
 */
export function joinDecl(decl: CellValue[][] | CellValue): string {
  const rows: CellValue[][] = Array.isArray(decl) ? decl : [[decl]];
  const parts: string[] = [];
  for (const row of rows) {
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const text = String(cell);
      if (text.trim()) parts.push(text);
    }
  }
  return parts.join("\n");
}

/** The build memo's key: the same request, the same handle. */
export function memoKey(decl: string, log2: number, bs: number): string {
  return JSON.stringify([decl, log2, bs]);
}

/** Whether `text` has the shape the server accepts as a session id. */
export function isSessionId(text: unknown): text is string {
  return typeof text === "string" && SESSION_ID.test(text);
}

/** A session id in the shape the SPA mints: `<ISO timestamp>-<uuid4>`. */
export function mintSessionId(now: Date, uuid: string): string {
  return `${now.toISOString()}-${uuid}`;
}

/**
 * Seconds to wait before retrying a 429.
 *
 * `Retry-After` may be a count of seconds or an HTTP date. Anything unreadable
 * waits `fallback`. The result is clamped to between 1 and 60 seconds, so a
 * misconfigured proxy cannot park a cell for an hour.
 */
export function retryAfterSeconds(
  header: string | null,
  now: number = Date.now(),
  fallback = 10
): number {
  let seconds = fallback;
  if (header) {
    const count = Number(header);
    if (Number.isFinite(count)) {
      seconds = count;
    } else {
      const when = Date.parse(header);
      if (Number.isFinite(when)) seconds = (when - now) / 1000;
    }
  }
  return Math.min(60, Math.max(1, Math.ceil(seconds)));
}

/** The `detail` of a FastAPI error body, or the body itself. */
function detailOf(body: unknown): unknown {
  if (body && typeof body === "object" && "detail" in body) {
    return (body as { detail: unknown }).detail;
  }
  return body;
}

/** Whether a 404 says the object id is not in the server's cache. */
export function isMissingObject(body: unknown): boolean {
  const detail = detailOf(body);
  return typeof detail === "string" && MISSING_OBJECT.test(detail);
}

/**
 * The message a failing cell shows, from the server's status and body.
 *
 * A parse error (`ErrorReport`) reads `line L, col C: message`. A structured
 * refusal (`session_reference`, `recipe_not_found`) reads its own `message`.
 * A plain string detail is shown as it is. FastAPI's own validation errors (a
 * list of `{loc, msg}`) show the first.
 */
export function errorMessage(status: number, body: unknown): string {
  if (status === 504) return MESSAGES.timeout;
  if (status === 429) return MESSAGES.rateLimited;
  const detail = detailOf(body);
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0] as { loc?: unknown[]; msg?: string };
    const where = Array.isArray(first.loc) ? first.loc.join(".") : "";
    if (first.msg) return where ? `${where}: ${first.msg}` : first.msg;
  }
  if (detail && typeof detail === "object") {
    const report = detail as { line?: unknown; column?: unknown; message?: unknown };
    if (
      typeof report.line === "number" &&
      typeof report.column === "number" &&
      typeof report.message === "string"
    ) {
      return `line ${report.line}, col ${report.column}: ${report.message}`;
    }
    if (typeof report.message === "string" && report.message) return report.message;
  }
  if (typeof detail === "string" && detail) return detail;
  return `server answered HTTP ${status}`;
}

/**
 * The recipe table read back from the workbook, keeping only well-formed rows.
 *
 * Document settings can hold anything a previous version or a hand edit left
 * there, so a row that is not a recipe is dropped rather than trusted.
 */
export function readRecipeTable(raw: unknown): RecipeTable {
  const table: RecipeTable = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return table;
  for (const [id, row] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[0-9a-f]{16}$/.test(id) || !row || typeof row !== "object") continue;
    const r = row as Partial<Recipe>;
    if (
      typeof r.decl === "string" &&
      typeof r.log2 === "number" &&
      typeof r.bs === "number" &&
      typeof r.seq === "number"
    ) {
      table[id] = { decl: r.decl, log2: r.log2, bs: r.bs, seq: r.seq };
    }
  }
  return table;
}

/**
 * Record `id`'s recipe as the newest entry, dropping the oldest past `limit`.
 *
 * Returns a new table. Recording an id again moves it to newest, so a handle
 * in active use is never the one dropped.
 */
export function rememberRecipe(
  table: RecipeTable,
  id: string,
  recipe: { decl: string; log2: number; bs: number },
  limit: number = RECIPE_LIMIT
): RecipeTable {
  let newest = 0;
  for (const row of Object.values(table)) newest = Math.max(newest, row.seq);
  const next: RecipeTable = { ...table, [id]: { ...recipe, seq: newest + 1 } };
  const ids = Object.keys(next).sort((a, b) => next[a].seq - next[b].seq);
  while (ids.length > limit) delete next[ids.shift() as string];
  return next;
}

/**
 * Probabilities from a number or a range, in reading order, each checked.
 *
 * The closed interval: `q(0)` and `q(1)` are the ends of the support and the
 * server answers both.
 *
 * @throws Error naming the first value outside [0, 1], which the server would
 *   refuse anyway; refusing here saves the round trip and says which value.
 */
export function probabilities(p: CellValue[][] | CellValue): number[] {
  const rows: CellValue[][] = Array.isArray(p) ? p : [[p]];
  const values: number[] = [];
  for (const row of rows) {
    for (const cell of row) {
      const value = typeof cell === "number" ? cell : Number(cell);
      if (cell === null || cell === undefined || cell === "" || !(value >= 0 && value <= 1)) {
        throw new Error(`every p must lie between 0 and 1 inclusive; got ${String(cell)}`);
      }
      values.push(value);
    }
  }
  if (!values.length) throw new Error("p is empty");
  return values;
}

/** Lay `values` out in the shape of `like`, row by row. */
export function reshape(values: number[], like: CellValue[][] | CellValue): number[][] {
  const rows: CellValue[][] = Array.isArray(like) ? like : [[like]];
  let k = 0;
  return rows.map((row) => row.map(() => values[k++]));
}

/** A TableDoc block, as much of it as flattening reads. */
interface Block {
  caption?: string;
  columns: unknown[];
  head: { text?: string; colspan?: number }[][];
  body: { cells: unknown[] }[];
  n_stub_levels: number;
}

/** A header row with each `colspan` label repeated across the columns it covers. */
function headerRow(row: { text?: string; colspan?: number }[]): string[] {
  const out: string[] = [];
  for (const cell of row) {
    const span = typeof cell?.colspan === "number" && cell.colspan > 1 ? cell.colspan : 1;
    for (let k = 0; k < span; k++) out.push(cell?.text ?? "");
  }
  return out;
}

/** A stub cell: plain text, or `{text, rowspan}` on a multi-level stub. */
function stubText(cell: unknown): { text: string; span: number } {
  if (typeof cell === "string") return { text: cell, span: 1 };
  const c = (cell ?? {}) as { text?: unknown; rowspan?: unknown };
  const span = typeof c.rowspan === "number" && c.rowspan > 1 ? c.rowspan : 1;
  return { text: c.text === undefined || c.text === null ? "" : String(c.text), span };
}

/** A value cell: its raw number, its text when it has no number, or empty. */
function valueOf(cell: unknown): string | number | boolean {
  if (cell === null || cell === undefined) return "";
  if (typeof cell !== "object") return cell as string | number | boolean;
  const c = cell as { raw?: unknown; text?: unknown };
  if (typeof c.raw === "number" || typeof c.raw === "boolean") return c.raw;
  if (typeof c.raw === "string") return c.raw;
  if (c.raw === null) return "";
  return c.text === undefined || c.text === null ? "" : String(c.text);
}

/** Pad every row of `rows` to `width` with empty strings. */
function padded(rows: Grid, width: number): Grid {
  return rows.map((row) => row.concat(Array(Math.max(0, width - row.length)).fill("")));
}

/**
 * One block as rows: the header rows (when asked), then the body.
 *
 * Stub cells are text. A spanned cell's label is repeated into every row or
 * column it covers: a stub cell with a `rowspan` covers the same column in the
 * rows below it, which then arrive one cell short, and a header cell with a
 * `colspan` covers the columns to its right. So every spilled row and column
 * says what it is, and a lookup on either finds it. Value cells are their raw
 * numbers, an empty string where the raw value is null.
 */
function blockRows(block: Block, headers: boolean): Grid {
  const width = block.columns.length;
  const stubs = block.n_stub_levels ?? 0;
  const rows: Grid = [];
  if (headers) {
    for (const row of block.head ?? []) rows.push(headerRow(row));
  }
  const carry: { text: string; left: number }[] = [];
  for (const row of block.body ?? []) {
    const cells = row.cells ?? [];
    const out: (string | number | boolean)[] = [];
    let next = 0;
    for (let col = 0; col < width; col++) {
      const held = carry[col];
      if (col < stubs && held && held.left > 0) {
        out.push(held.text);
        held.left -= 1;
        continue;
      }
      if (next >= cells.length) {
        out.push("");
        continue;
      }
      const cell = cells[next++];
      if (col < stubs) {
        const { text, span } = stubText(cell);
        carry[col] = { text, left: span - 1 };
        out.push(text);
      } else {
        out.push(valueOf(cell));
      }
    }
    rows.push(out);
  }
  return padded(rows, width);
}

/**
 * An exhibit envelope flattened for a spill.
 *
 * @param payload The body of `GET /v1/objects/{id}/exhibit/{name}`.
 * @param block 0 stacks every block, each preceded by its caption row and
 *   separated by a blank row; k (from 1) returns block k alone, without its
 *   caption, for use in formulas.
 * @param headers Whether to include the header rows.
 * @throws Error when `block` names a block the exhibit does not have.
 */
export function flattenExhibit(payload: unknown, block = 0, headers = true): Grid {
  const blocks = ((payload ?? {}) as { blocks?: Block[] }).blocks ?? [];
  const name = ((payload ?? {}) as { name?: string }).name ?? "exhibit";
  if (!Number.isInteger(block) || block < 0 || block > blocks.length) {
    throw new Error(
      `${name} has ${blocks.length} block${blocks.length === 1 ? "" : "s"}; ` +
        `block must be 0 (all) or 1 to ${blocks.length}`
    );
  }
  if (block > 0) return blockRows(blocks[block - 1], headers);
  const parts: Grid[] = blocks.map((b) => blockRows(b, headers));
  const width = Math.max(1, ...parts.map((p) => (p[0] ?? []).length));
  const rows: Grid = [];
  blocks.forEach((b, i) => {
    if (i > 0) rows.push([]);
    if (b.caption) rows.push([b.caption]);
    rows.push(...parts[i]);
  });
  return padded(rows.length ? rows : [[""]], width);
}

/** The formats `GET /v1/objects/{id}/frame/{which}.<format>` serves. */
export const FRAME_FORMATS = ["csv", "parquet"];

/**
 * The frame format an argument names: `csv` when omitted or empty.
 *
 * @throws Error naming the argument when it is neither format.
 */
export function frameFormat(format: unknown): string {
  if (format === undefined || format === null || format === "") return "csv";
  const name = String(format).trim().toLowerCase();
  if (!FRAME_FORMATS.includes(name)) {
    throw new Error(`format must be ${FRAME_FORMATS.join(" or ")}; got ${String(format)}`);
  }
  return name;
}

/**
 * The absolute URL that loads a whole frame: Data, From Web takes it as it is.
 *
 * @param base The API's origin, without a trailing slash (one is tolerated).
 * @param id The object id.
 * @param which The frame name, such as `density_df`.
 * @param format `csv` or `parquet`, already checked by `frameFormat`.
 */
export function frameDownloadUrl(base: string, id: string, which: string, format = "csv"): string {
  const origin = base.replace(/\/+$/, "");
  return `${origin}/v1/objects/${encodeURIComponent(id)}/frame/${encodeURIComponent(which)}.${format}`;
}

/**
 * The refreshable Power Query that loads a whole frame, with `base` and the
 * frame name filled in.
 *
 * The query in `excel/README.md`, "Whole frames through Power Query": it reads
 * the program from a cell named `Decl`, builds it at log2 16 (a program the
 * server already holds comes straight back, so a refresh survives a restart),
 * loads the frame from the `.csv` route and types every column as a number,
 * reading `inf` and `-inf` as infinities. Excel's Power Query has no Parquet
 * connector, so the CSV route is the one it takes.
 *
 * @param base The API's origin, without a trailing slash (one is tolerated).
 * @param which The frame name, such as `density_df`.
 */
export function powerQuery(base: string, which: string): string {
  const origin = base.replace(/\/+$/, "");
  return [
    "let",
    `    base  = "${origin}",`,
    '    decl  = Excel.CurrentWorkbook(){[Name = "Decl"]}[Content]{0}[Column1],',
    '    built = Json.Document(Web.Contents(base, [RelativePath = "v1/objects",',
    '              Headers = [#"Content-Type" = "application/json"],',
    "              Content = Json.FromValue([decl = decl, log2 = 16,",
    "                                        library_references_only = true])])),",
    "    raw   = Csv.Document(Web.Contents(base,",
    `              [RelativePath = "v1/objects/" & built[id] & "/frame/${which}.csv"]),`,
    '              [Delimiter = ",", Encoding = TextEncoding.Utf8, QuoteStyle = QuoteStyle.Csv]),',
    "    named = Table.PromoteHeaders(raw, [PromoteAllScalars = true]),",
    "    toNumber = (t) =>",
    '              if t = "inf" then Number.PositiveInfinity',
    '              else if t = "-inf" then Number.NegativeInfinity',
    '              else if t = "" or t = "nan" then null',
    '              else Number.From(t, "en-US"),',
    "    typed = Table.TransformColumns(named,",
    "              List.Transform(Table.ColumnNames(named), each {_, toNumber, type number}))",
    "in",
    "    typed",
  ].join("\n");
}

/**
 * The frames listing as a spill: a header row, then `name | rows | columns`.
 *
 * @param payload The body of `GET /v1/objects/{id}/frames`.
 */
export function frameRows(payload: unknown): Grid {
  const body = (payload ?? {}) as { frames?: { name: string; rows: number; columns: number }[] };
  const items = body.frames ?? [];
  return [["name", "rows", "columns"], ...items.map((f) => [f.name, f.rows, f.columns])];
}

/** One library entry, as much of `GET /v1/examples` as the add-in reads. */
export interface LibraryItem {
  name: string;
  kind: string;
  /** The program as its `.agg` file spells it, trailers included. */
  decl: string;
}

/** The entry named exactly `name`, or `null`. Names are unique within a file. */
export function libraryEntry(items: LibraryItem[], name: unknown): LibraryItem | null {
  const wanted = String(name ?? "").trim();
  if (!wanted) return null;
  return items.find((item) => item.name === wanted) ?? null;
}

/** The library as a spill: a header row, then `name | kind` in file order. */
export function libraryRows(items: LibraryItem[]): Grid {
  return [["name", "kind"], ...items.map((item) => [item.name, item.kind])];
}

/** The refusal for a library name no entry carries. */
export function noLibraryEntry(name: unknown): string {
  return `no library entry named ${String(name ?? "").trim()}; AGG.LIBRARY() lists them`;
}

/**
 * A counting semaphore: at most `limit` tasks run at once, the rest wait in order.
 */
export class Semaphore {
  private readonly limit: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  /**
   * Run `task` once a slot is free, releasing the slot however it ends.
   *
   * A released slot passes straight to the next waiter rather than being
   * freed and re-taken, so a caller arriving in between cannot take it too
   * and push the count past the limit.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active -= 1;
    }
  }

  /** Tasks running now, for tests. */
  get running(): number {
    return this.active;
  }
}
