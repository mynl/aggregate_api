/* global AbortController, AbortSignal, CustomFunctions, Office, Response, crypto, fetch, globalThis, setTimeout */

/**
 * The AGG custom functions: aggregate_api in worksheet cells.
 *
 * Every function is pure in the sense Excel needs: its value depends on its
 * arguments alone. That holds because an object id hashes what a program
 * means (aggregate_api 1.14.0), and because AGG.BUILD resolves library entries
 * only, so no cell depends on another cell Excel cannot see. Programs combine
 * through text instead, which Excel tracks: =AGG.BUILD("port P " & A1 & " " & B1).
 *
 * The pure logic is in ./core and unit tested; this file is the Office and
 * network layer around it. The signatures spell their types out (`any[][]`
 * rather than core's aliases) because the metadata plugin that writes
 * functions.json reads only literal types.
 */

import type { CellValue, Handle, RecipeTable } from "./core";
import {
  MAX_IN_FLIGHT,
  MESSAGES,
  RATE_LIMIT_RETRIES,
  Semaphore,
  errorMessage,
  flattenExhibit,
  formatHandle,
  frameDownloadUrl,
  frameFormat,
  frameRows,
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
} from "./core";

/** The API base, fixed at build time: empty for the same origin. */
declare const __API_BASE__: string;
const API_BASE: string = __API_BASE__;

/**
 * The API's absolute origin, for a URL handed to something other than `fetch`.
 *
 * `fetch` resolves an empty base against the page, but a URL pasted into
 * Data, From Web or a Power Query has to be absolute, so the empty production
 * base becomes the origin the add-in was served from, which is the server.
 */
function apiOrigin(): string {
  if (API_BASE) return API_BASE;
  const location = (globalThis as { location?: { origin?: string } }).location;
  return location?.origin ?? "";
}

const SESSION_HEADER = "X-Aggregate-Session";
const SETTINGS_SESSION = "aggregate.session";
const SETTINGS_RECIPES = "aggregate.recipes";

const ready = Office.onReady();
const slots = new Semaphore(MAX_IN_FLIGHT);

/** `(decl, log2, bs)` to the value AGG.BUILD last returned, for this runtime. */
const memo = new Map<string, string | number>();

/** The same key while its build is in flight, so a sheet of cells sharing one program posts it once. */
const inflight = new Map<string, Promise<string | number>>();

let session: string | null = null;
let recipes: RecipeTable | null = null;
let saveScheduled = false;

interface Reply {
  status: number;
  body: unknown;
}

/**
 * Fail the cell with `#VALUE!` and `message` on hover.
 *
 * For transient failures only: unreachable, rate limited after the retries,
 * timed out, a server fault, and the recalculate instruction, which must stay
 * an error so dependents do not compute on it. Everything about the program or
 * the arguments is a `Refusal`, returned as readable text.
 */
function fail(message: string): never {
  throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, message);
}

/**
 * A refusal, carrying the `#AGG!` text the cell should show.
 *
 * Thrown where a handle was needed and the program behind it did not build,
 * where the server refused a request about the object, and where an argument
 * is wrong, so the function can return the reason as its value rather than as
 * an Excel error nobody can read.
 */
class Refusal extends Error {}

/** Throw a `Refusal` for a message the add-in raised itself. */
function refuse(message: string): never {
  throw new Refusal(localRefusalText(message));
}

/** Run a spilling function, turning a refusal into a one-cell spill of its text. */
async function rowsOrRefusal(work: () => Promise<any[][]>): Promise<any[][]> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Refusal) return [[error.message]];
    throw error;
  }
}

/** The workbook's document settings, once Office is ready. */
async function settings(): Promise<Office.Settings> {
  await ready;
  return Office.context.document.settings;
}

/**
 * Save the document settings soon, once, however many changes arrive.
 *
 * A full recalculation can record hundreds of recipes; one save a second is
 * plenty, and the settings travel inside the .xlsx when the workbook is saved.
 */
function scheduleSave(store: Office.Settings): void {
  if (saveScheduled) return;
  saveScheduled = true;
  setTimeout(() => {
    saveScheduled = false;
    store.saveAsync();
  }, 1000);
}

/**
 * This workbook's session id, minted once and kept in its settings.
 *
 * It no longer affects object ids. It gives each workbook its own rate-limit
 * budget on the public instance, which keys on the header, and makes the
 * status page legible.
 */
async function sessionId(): Promise<string> {
  if (session) return session;
  const store = await settings();
  const saved = store.get(SETTINGS_SESSION);
  if (isSessionId(saved)) {
    session = saved;
  } else {
    session = mintSessionId(new Date(), crypto.randomUUID());
    store.set(SETTINGS_SESSION, session);
    scheduleSave(store);
  }
  return session;
}

/** The workbook's recipe table: object id to the request that built it. */
async function recipeTable(): Promise<RecipeTable> {
  if (!recipes) recipes = readRecipeTable((await settings()).get(SETTINGS_RECIPES));
  return recipes;
}

/** Record how `id` was built, so a handle saved in a cell survives a restart. */
async function remember(id: string, decl: string, log2: number, bs: number): Promise<void> {
  recipes = rememberRecipe(await recipeTable(), id, { decl, log2, bs });
  const store = await settings();
  store.set(SETTINGS_RECIPES, recipes);
  scheduleSave(store);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One request to the API, through the in-flight limit, retrying a 429.
 *
 * @returns The status and the parsed body. Only a network failure throws
 *   (as "server unreachable"); every HTTP status is the caller's to read.
 */
async function request(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal
): Promise<Reply> {
  const headers: Record<string, string> = { [SESSION_HEADER]: await sessionId() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await slots.run(() =>
        fetch(API_BASE + path, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal,
        })
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      return fail(MESSAGES.unreachable);
    }
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      await sleep(retryAfterSeconds(response.headers.get("Retry-After")) * 1000);
      continue;
    }
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // A proxy's HTML error page: keep the text for the message.
    }
    return { status: response.status, body: parsed };
  }
}

/** POST a build that resolves library entries only. */
function postBuild(decl: string, log2: number, bs: number, signal?: AbortSignal): Promise<Reply> {
  const payload: Record<string, unknown> = { decl, library_references_only: true };
  if (log2) payload.log2 = log2;
  if (bs) payload.bs = bs;
  return request("POST", "/v1/objects", payload, signal);
}

/**
 * GET a route on the object a handle names, rebuilding it once if the server
 * has lost it.
 *
 * A 404 saying the object is not in cache means it was evicted or the server
 * restarted. The recipe table says how it was built, so it is posted again: the
 * same id coming back means the same object, and the GET is retried once. A
 * different id means the server's library or versions changed, and every
 * handle in the workbook is suspect, so the memo is cleared and the cell asks
 * for a full recalculation.
 *
 * Any other 4xx is about the request (an exhibit or frame name the object does
 * not have, a `p` the route refuses) and is returned as `#AGG!` text, since the
 * server's message is written to be read: a frame route's 404 lists the valid
 * names. A 429 and every 5xx stay Excel errors.
 */
async function readObject(handleText: unknown, path: (id: string) => string): Promise<unknown> {
  return readFrom(await handleOf(handleText), path);
}

/** `readObject` for a handle already resolved; see there. */
async function readFrom(handle: Handle, path: (id: string) => string): Promise<unknown> {
  let reply = await request("GET", path(handle.id));
  if (reply.status === 404 && isMissingObject(reply.body)) {
    const recipe = (await recipeTable())[handle.id];
    if (!recipe) return refuse(MESSAGES.unknownHandle);
    const rebuilt = await postBuild(recipe.decl, recipe.log2, recipe.bs);
    if (isProgramRefusal(rebuilt.status)) {
      throw new Refusal(refusalText(rebuilt.status, rebuilt.body));
    }
    if (rebuilt.status !== 200) return fail(errorMessage(rebuilt.status, rebuilt.body));
    if ((rebuilt.body as { id?: string }).id !== handle.id) {
      memo.clear();
      return fail(MESSAGES.upgraded);
    }
    reply = await request("GET", path(handle.id));
  }
  if (isProgramRefusal(reply.status)) throw new Refusal(refusalText(reply.status, reply.body));
  if (reply.status !== 200) return fail(errorMessage(reply.status, reply.body));
  return reply.body;
}

/**
 * The handle a `handle` argument names: as given, or built from the program it holds.
 *
 * The argument is a cell or a range, joined like AGG.BUILD's. A program takes
 * the default grid and goes through the same path as AGG.BUILD (the memo, the
 * recipe table, library references only), so the cell then behaves exactly as
 * if it held the handle AGG.BUILD would have returned. A refused program, a
 * cell already holding a refusal's text, or an argument that is neither a
 * handle nor a program throws `Refusal` with the text to show.
 */
async function handleOf(handleCells: unknown) {
  const text = joinDecl(handleCells as CellValue[][] | CellValue);
  if (isRefusal(text)) throw new Refusal(text);
  const arg = programOrHandle(text);
  if (!arg) return refuse(MESSAGES.notAHandle);
  if ("handle" in arg) return arg.handle;
  const built = await buildOnce(arg.program, 0, 0);
  if (typeof built === "string" && isRefusal(built)) throw new Refusal(built);
  const made = parseHandle(built);
  if (!made) return refuse(MESSAGES.programIsValue);
  return made;
}

/**
 * Build a program once per runtime: the memo, else the build in flight, else a POST.
 *
 * Concurrent callers with the same key share one promise, so a full
 * recalculation of twenty cells over one program is one request. A shared
 * refusal reaches every one of them as the same text, and is memoized like a
 * handle: the same program draws the same refusal until it is edited.
 */
function buildOnce(
  program: string,
  log2: number,
  bs: number,
  signal?: AbortSignal
): Promise<string | number> {
  const key = memoKey(program, log2, bs);
  const known = memo.get(key);
  if (known !== undefined) return Promise.resolve(known);
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const reply = await postBuild(program, log2, bs, signal);
      if (isProgramRefusal(reply.status)) {
        const refusal = refusalText(reply.status, reply.body);
        memo.set(key, refusal);
        return refusal;
      }
      if (reply.status !== 200) return fail(errorMessage(reply.status, reply.body));
      const made = reply.body as { kind: string; name?: string; id?: string; value?: number };
      if (made.kind === "value") {
        memo.set(key, made.value as number);
        return made.value as number;
      }
      const handle = formatHandle(made.kind, made.name ?? "", made.id as string);
      await remember(made.id as string, program, log2, bs);
      memo.set(key, handle);
      return handle;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/**
 * The server's version and the aggregate library's.
 * @customfunction VERSION
 * @returns Both versions, as /v1/meta reports them.
 */
export async function version(): Promise<string> {
  const reply = await request("GET", "/v1/meta");
  if (reply.status !== 200) return fail(errorMessage(reply.status, reply.body));
  const meta = reply.body as { version?: string; aggregate_version?: string };
  return `aggregate_api ${meta.version}, aggregate ${meta.aggregate_version}`;
}

/**
 * Build a DecL program and return its handle. References resolve to library entries only.
 * @customfunction BUILD
 * @cancelable
 * @param decl The program: a cell, or a range whose non-empty cells join in reading order.
 * @param [log2] log2 of the grid size. Omit to let the library choose.
 * @param [bs] Bucket size. Omit to let the library choose.
 * @param [invocation] Supplied by Excel.
 * @returns A handle such as agg.A#4f40714271198d8f, the number a program such as (2+2) means, or #AGG! and the reason the server refused the program.
 */
export async function build(
  decl: any[][],
  log2?: number,
  bs?: number,
  invocation?: CustomFunctions.CancelableInvocation
): Promise<any> {
  const program = joinDecl(decl);
  if (!program) return localRefusalText(MESSAGES.emptyProgram);
  if (isRefusal(program)) return program;
  const controller = new AbortController();
  if (invocation) invocation.onCanceled = () => controller.abort();
  return buildOnce(program, log2 ?? 0, bs ?? 0, controller.signal);
}

/**
 * The exhibits an object can show.
 * @customfunction EXHIBITS
 * @param handle A handle from AGG.BUILD, or a DecL program: a cell or a range.
 * @returns One row per exhibit: name, title, perspectives. #AGG! and the reason if the program or the argument is refused.
 */
export async function exhibits(handle: any[][]): Promise<any[][]> {
  return rowsOrRefusal(async () => {
    const body = await readObject(handle, (id) => `/v1/objects/${id}/exhibits`);
    const items =
      (body as { exhibits?: { name: string; title: string; perspectives: string[] }[] }).exhibits ??
      [];
    return [
      ["name", "title", "perspectives"],
      ...items.map((e) => [e.name, e.title, e.perspectives.join(", ")]),
    ];
  });
}

/**
 * One exhibit, as values.
 * @customfunction EXHIBIT
 * @param handle A handle from AGG.BUILD, or a DecL program: a cell or a range.
 * @param name The exhibit, such as summary; AGG.EXHIBITS lists them.
 * @param [perspective] raw (the default) or insurer.
 * @param [block] 0 (the default) stacks every block under its caption; k returns block k alone.
 * @param [headers] Whether to include the header rows. Default TRUE.
 * @returns The exhibit's rows: labels as text, values as numbers. #AGG! and the reason if the program or an argument is refused.
 */
export async function exhibit(
  handle: any[][],
  name: string,
  perspective?: string,
  block?: number,
  headers?: boolean
): Promise<any[][]> {
  return rowsOrRefusal(async () => {
    const view = encodeURIComponent(perspective || "raw");
    const body = await readObject(
      handle,
      (id) => `/v1/objects/${id}/exhibit/${encodeURIComponent(name)}?perspective=${view}`
    );
    try {
      return flattenExhibit(body, block ?? 0, headers ?? true);
    } catch (error) {
      return refuse((error as Error).message);
    }
  });
}

/**
 * Quantiles of the object's total loss.
 * @customfunction Q
 * @param handle A handle from AGG.BUILD, or a DecL program: a cell or a range.
 * @param p A probability, or a range of them, each between 0 and 1 inclusive.
 * @returns The exact quantile at each p, in the shape of p. #AGG! and the reason if the program or a p is refused.
 */
export async function q(handle: any[][], p: number[][]): Promise<any[][]> {
  return rowsOrRefusal(async () => {
    let values: number[];
    try {
      values = probabilities(p);
    } catch (error) {
      return refuse((error as Error).message);
    }
    const body = await readObject(
      handle,
      (id) => `/v1/objects/${id}/quantiles?snap=false&p=${values.join(",")}`
    );
    const rows = (body as { quantiles?: { q: number }[] }).quantiles ?? [];
    return reshape(
      rows.map((row) => row.q),
      p
    );
  });
}

/**
 * The frames an object has, with their shapes.
 * @customfunction FRAMES
 * @param handle A handle from AGG.BUILD, or a DecL program: a cell or a range.
 * @returns One row per frame: name, rows, columns. #AGG! and the reason if the program is refused.
 */
export async function frames(handle: any[][]): Promise<any[][]> {
  return rowsOrRefusal(async () =>
    frameRows(await readObject(handle, (id) => `/v1/objects/${id}/frames`))
  );
}

/**
 * The URL that loads a whole frame: paste it into Data, From Web, or into a Power Query.
 * @customfunction FRAMEURL
 * @param handle A handle from AGG.BUILD, or a DecL program: a cell or a range.
 * @param which The frame, such as density_df; AGG.FRAMES lists them.
 * @param [format] csv (the default) or parquet.
 * @returns The absolute URL of the frame. #AGG! and the reason if the program, the frame name or the format is refused.
 */
export async function frameUrl(handle: any[][], which: string, format?: string): Promise<any> {
  const rows = await rowsOrRefusal(async () => {
    let kind: string;
    try {
      kind = frameFormat(format);
    } catch (error) {
      return refuse((error as Error).message);
    }
    const made = await handleOf(handle);
    // Ask for the shape first: an unknown name then reads the server's list of
    // frames here, rather than a URL that 404s only once it has been pasted.
    await readFrom(made, (id) => `/v1/objects/${id}/frame/${encodeURIComponent(which)}/shape`);
    return [[frameDownloadUrl(apiOrigin(), made.id, which, kind)]];
  });
  return rows[0][0];
}
