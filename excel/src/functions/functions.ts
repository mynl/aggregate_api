/* global AbortController, AbortSignal, CustomFunctions, Office, Response, crypto, fetch, setTimeout */

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

import type { RecipeTable } from "./core";
import {
  MAX_IN_FLIGHT,
  MESSAGES,
  RATE_LIMIT_RETRIES,
  Semaphore,
  errorMessage,
  flattenExhibit,
  formatHandle,
  isMissingObject,
  isSessionId,
  joinDecl,
  memoKey,
  mintSessionId,
  parseHandle,
  probabilities,
  readRecipeTable,
  rememberRecipe,
  reshape,
  retryAfterSeconds,
} from "./core";

/** The API base, fixed at build time: empty for the same origin. */
declare const __API_BASE__: string;
const API_BASE: string = __API_BASE__;

const SESSION_HEADER = "X-Aggregate-Session";
const SETTINGS_SESSION = "aggregate.session";
const SETTINGS_RECIPES = "aggregate.recipes";

const ready = Office.onReady();
const slots = new Semaphore(MAX_IN_FLIGHT);

/** `(decl, log2, bs)` to the value AGG.BUILD last returned, for this runtime. */
const memo = new Map<string, string | number>();

let session: string | null = null;
let recipes: RecipeTable | null = null;
let saveScheduled = false;

interface Reply {
  status: number;
  body: unknown;
}

/** Fail the cell with `#VALUE!` and `message` on hover. */
function fail(message: string): never {
  throw new CustomFunctions.Error(CustomFunctions.ErrorCode.invalidValue, message);
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
 */
async function readObject(handleText: unknown, path: (id: string) => string): Promise<unknown> {
  const handle = parseHandle(handleText);
  if (!handle) return fail(MESSAGES.notAHandle);
  let reply = await request("GET", path(handle.id));
  if (reply.status === 404 && isMissingObject(reply.body)) {
    const recipe = (await recipeTable())[handle.id];
    if (!recipe) return fail(MESSAGES.unknownHandle);
    const rebuilt = await postBuild(recipe.decl, recipe.log2, recipe.bs);
    if (rebuilt.status !== 200) return fail(errorMessage(rebuilt.status, rebuilt.body));
    if ((rebuilt.body as { id?: string }).id !== handle.id) {
      memo.clear();
      return fail(MESSAGES.upgraded);
    }
    reply = await request("GET", path(handle.id));
  }
  if (reply.status !== 200) return fail(errorMessage(reply.status, reply.body));
  return reply.body;
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
 * @returns A handle such as agg.A#4f40714271198d8f, or the number a program such as (2+2) means.
 */
export async function build(
  decl: any[][],
  log2?: number,
  bs?: number,
  invocation?: CustomFunctions.CancelableInvocation
): Promise<any> {
  const program = joinDecl(decl);
  if (!program) return fail(MESSAGES.emptyProgram);
  const grid = log2 ?? 0;
  const bucket = bs ?? 0;
  const key = memoKey(program, grid, bucket);
  const known = memo.get(key);
  if (known !== undefined) return known;

  const controller = new AbortController();
  if (invocation) invocation.onCanceled = () => controller.abort();
  const reply = await postBuild(program, grid, bucket, controller.signal);
  if (reply.status !== 200) return fail(errorMessage(reply.status, reply.body));
  const made = reply.body as { kind: string; name?: string; id?: string; value?: number };
  if (made.kind === "value") {
    memo.set(key, made.value as number);
    return made.value;
  }
  const handle = formatHandle(made.kind, made.name ?? "", made.id as string);
  await remember(made.id as string, program, grid, bucket);
  memo.set(key, handle);
  return handle;
}

/**
 * The exhibits an object can show.
 * @customfunction EXHIBITS
 * @param handle A handle from AGG.BUILD.
 * @returns One row per exhibit: name, title, perspectives.
 */
export async function exhibits(handle: string): Promise<any[][]> {
  const body = await readObject(handle, (id) => `/v1/objects/${id}/exhibits`);
  const items =
    (body as { exhibits?: { name: string; title: string; perspectives: string[] }[] }).exhibits ??
    [];
  return [
    ["name", "title", "perspectives"],
    ...items.map((e) => [e.name, e.title, e.perspectives.join(", ")]),
  ];
}

/**
 * One exhibit, as values.
 * @customfunction EXHIBIT
 * @param handle A handle from AGG.BUILD.
 * @param name The exhibit, such as summary; AGG.EXHIBITS lists them.
 * @param [perspective] raw (the default) or insurer.
 * @param [block] 0 (the default) stacks every block under its caption; k returns block k alone.
 * @param [headers] Whether to include the header rows. Default TRUE.
 * @returns The exhibit's rows: labels as text, values as numbers.
 */
export async function exhibit(
  handle: string,
  name: string,
  perspective?: string,
  block?: number,
  headers?: boolean
): Promise<any[][]> {
  const view = encodeURIComponent(perspective || "raw");
  const body = await readObject(
    handle,
    (id) => `/v1/objects/${id}/exhibit/${encodeURIComponent(name)}?perspective=${view}`
  );
  try {
    return flattenExhibit(body, block ?? 0, headers ?? true);
  } catch (error) {
    return fail((error as Error).message);
  }
}

/**
 * Quantiles of the object's total loss.
 * @customfunction Q
 * @param handle A handle from AGG.BUILD.
 * @param p A probability, or a range of them, each strictly between 0 and 1.
 * @returns The exact quantile at each p, in the shape of p.
 */
export async function q(handle: string, p: number[][]): Promise<number[][]> {
  let values: number[];
  try {
    values = probabilities(p);
  } catch (error) {
    return fail((error as Error).message);
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
}
