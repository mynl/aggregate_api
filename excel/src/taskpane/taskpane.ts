/* global Excel, HTMLButtonElement, HTMLElement, HTMLInputElement, HTMLParagraphElement, HTMLSelectElement, HTMLTextAreaElement, Office, Option, Response, document, fetch, navigator, setTimeout */

/**
 * The task pane: the About list, and the Whole frames section.
 *
 * The shared runtime loads this page so the custom functions have Office.js.
 * The page explains the functions, and hands out the two texts that load a
 * whole frame and that nobody can type: the CSV URL for Data, From Web, and
 * the M query for a refreshable Power Query. The handle comes from the
 * selected cell; a program in the cell is built first, as everywhere.
 *
 * It reads the server itself rather than importing ../functions/functions:
 * webpack bundles each entry separately, so an import here would run a second
 * copy of that module, with its own memo and request limit, in the same
 * runtime. The pure helpers in ../functions/core are import-free and safe to
 * share, and the URL and the query are built there so `node --test` covers
 * them.
 */

import { frameDownloadUrl, joinDecl, parseHandle, powerQuery } from "../functions/core";

declare const __API_BASE__: string;

/** The API's absolute origin: the build-time base, else the origin that served the add-in. */
function apiOrigin(): string {
  return __API_BASE__ || document.location.origin;
}

const SETTINGS_SESSION = "aggregate.session";
const SESSION_HEADER = "X-Aggregate-Session";

/** This workbook's session header, when the functions have minted one; keeps one rate-limit budget per workbook. */
function sessionHeaders(): Record<string, string> {
  const saved = Office.context?.document?.settings?.get(SETTINGS_SESSION);
  return typeof saved === "string" && saved ? { [SESSION_HEADER]: saved } : {};
}

interface FrameItem {
  name: string;
  rows: number;
  columns: number;
}

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** The first `detail` sentence of a FastAPI error body, or the status. */
async function reasonOf(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail.message === "string") return detail.message;
  } catch {
    // Not JSON: fall through to the status.
  }
  return `server answered HTTP ${response.status}`;
}

/**
 * The object id the Handle box names: parsed from a handle, or built from a program.
 *
 * A build goes with `library_references_only`, as the functions' builds do, so
 * the id is the one `AGG.BUILD` would have returned for the same text.
 */
async function objectIdOf(text: string): Promise<string> {
  const handle = parseHandle(text);
  if (handle) return handle.id;
  const program = text.trim();
  if (!program) throw new Error("pick a cell holding a handle or a program");
  const response = await fetch(`${apiOrigin()}/v1/objects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sessionHeaders() },
    body: JSON.stringify({ decl: program, library_references_only: true }),
  });
  if (!response.ok) throw new Error(await reasonOf(response));
  const made = await response.json();
  if (made.kind === "value") throw new Error("this program is a number, not an object");
  if (made.kind === "text") throw new Error("this program is a conversion, not an object");
  return made.id as string;
}

/** The frames the object has, from `GET /v1/objects/{id}/frames`. */
async function framesOf(id: string): Promise<FrameItem[]> {
  const response = await fetch(`${apiOrigin()}/v1/objects/${id}/frames`, {
    headers: sessionHeaders(),
  });
  if (!response.ok) throw new Error(await reasonOf(response));
  return ((await response.json()).frames ?? []) as FrameItem[];
}

/** The id the Frame dropdown was filled for, so a frame change needs no second fetch. */
let currentId: string | null = null;

/** Fill the two paste boxes for the current id and the chosen frame. */
function showTexts(): void {
  const which = byId<HTMLSelectElement>("frame").value;
  const fromWeb = byId<HTMLInputElement>("from-web");
  const query = byId<HTMLTextAreaElement>("query");
  const ready = Boolean(currentId && which);
  fromWeb.value = ready ? frameDownloadUrl(apiOrigin(), currentId as string, which, "csv") : "";
  query.value = ready ? powerQuery(apiOrigin(), which) : "";
  byId<HTMLButtonElement>("copy-from-web").disabled = !ready;
  byId<HTMLButtonElement>("copy-query").disabled = !ready;
}

/** Resolve the Handle box, fill the Frame dropdown (`density_df` first when present) and the texts. */
async function refreshFrames(): Promise<void> {
  const status = byId<HTMLParagraphElement>("frames-status");
  const select = byId<HTMLSelectElement>("frame");
  const text = byId<HTMLInputElement>("handle").value;
  currentId = null;
  select.innerHTML = "";
  select.disabled = true;
  showTexts();
  if (!text.trim()) {
    select.appendChild(new Option("pick a handle first", ""));
    status.textContent = "";
    return;
  }
  status.textContent = "Asking the server…";
  try {
    const id = await objectIdOf(text);
    const frames = await framesOf(id);
    if (!frames.length) throw new Error("this object has no frames");
    for (const frame of frames) {
      const label = `${frame.name}  (${frame.rows.toLocaleString()} rows × ${frame.columns})`;
      select.appendChild(new Option(label, frame.name));
    }
    select.value = frames.some((f) => f.name === "density_df") ? "density_df" : frames[0].name;
    select.disabled = false;
    currentId = id;
    status.textContent = "";
  } catch (error) {
    select.appendChild(new Option("pick a handle first", ""));
    status.textContent = (error as Error).message;
  }
  showTexts();
}

/**
 * The selected cell or range, joined as a program would be.
 *
 * A range holding a program one clause per cell joins with newlines, exactly
 * as the functions join a `decl` range, so the id the pane builds is the one
 * the cells have.
 */
async function selectedText(): Promise<string> {
  return Excel.run(async (context) => {
    const range = context.workbook.getSelectedRange();
    range.load("values");
    await context.sync();
    return joinDecl(range.values as (string | number | boolean | null)[][]);
  });
}

async function useSelection(): Promise<void> {
  try {
    byId<HTMLInputElement>("handle").value = await selectedText();
  } catch (error) {
    byId<HTMLParagraphElement>("frames-status").textContent = (error as Error).message;
    return;
  }
  await refreshFrames();
}

/**
 * Copy `text`, saying "Copied" on the button for two seconds.
 *
 * The clipboard API can be refused in an add-in's web view, so the fallback
 * selects the box's text and leaves Ctrl+C to the reader, with the button
 * saying so.
 */
async function copyText(
  button: HTMLButtonElement,
  box: HTMLInputElement | HTMLTextAreaElement
): Promise<void> {
  const label = button.textContent;
  let said = "Copied";
  try {
    await navigator.clipboard.writeText(box.value);
  } catch {
    box.focus();
    box.select();
    said = "Press Ctrl+C";
  }
  button.textContent = said;
  setTimeout(() => {
    button.textContent = label;
  }, 2000);
}

Office.onReady(async () => {
  const line = document.getElementById("server");
  if (line) {
    try {
      const meta = await (await fetch(`${apiOrigin()}/v1/meta`)).json();
      line.textContent = `Server: aggregate_api ${meta.version}, aggregate ${meta.aggregate_version}`;
    } catch {
      line.textContent = "Server: unreachable";
    }
  }
  if (!document.getElementById("frames")) return;
  byId<HTMLButtonElement>("use-selection").addEventListener("click", () => void useSelection());
  byId<HTMLInputElement>("handle").addEventListener("change", () => void refreshFrames());
  byId<HTMLSelectElement>("frame").addEventListener("change", showTexts);
  byId<HTMLButtonElement>("copy-from-web").addEventListener(
    "click",
    (ev) => void copyText(ev.currentTarget as HTMLButtonElement, byId<HTMLInputElement>("from-web"))
  );
  byId<HTMLButtonElement>("copy-query").addEventListener(
    "click",
    (ev) => void copyText(ev.currentTarget as HTMLButtonElement, byId<HTMLTextAreaElement>("query"))
  );
  // Prefill from the selected cell when the pane opens; an empty or
  // unreadable selection leaves the box empty rather than reporting.
  try {
    const text = await selectedText();
    if (text.trim()) {
      byId<HTMLInputElement>("handle").value = text;
      await refreshFrames();
    }
  } catch {
    // No selection to read: the Use selected cell button is there.
  }
});
