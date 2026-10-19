/**
 * The test harness: the built dist/*.js in a `node:vm` context, with stub Apps
 * Script services and a fake server.
 *
 * Nothing runs Apps Script locally, so the tests load the very files `clasp
 * push` uploads. `npm test` builds them first (the `pretest` script). The fake
 * server answers from the payloads Excel's tests already captured under
 * excel/test/fixtures/, and keeps a set of object ids it holds, so a test can
 * evict one or make the server start answering with different ids.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const DIST = new URL("../dist/", import.meta.url);
const FIXTURES = new URL("../../excel/test/fixtures/", import.meta.url);

export const SPREADSHEET_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg";

/** A captured payload from excel/test/fixtures/. */
export function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURES), "utf8"));
}

/** A value from the vm context as plain JSON, so `deepEqual` does not trip on its realm. */
export function plain(value: unknown): any {
  return JSON.parse(JSON.stringify(value));
}

export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  payload: any;
}

export interface Answer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Handler = (request: Request, match: RegExpExecArray) => Answer | undefined;

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** A sheet for the menu tests: a block of formulas whose top left is (top, left). */
export function formulaSheet(name: string, formulas: string[][], log: unknown[][], top = 1, left = 1) {
  return {
    getName: () => name,
    getDataRange: () => ({ getRow: () => top, getColumn: () => left, getFormulas: () => formulas }),
    getRange: (row: number, column: number) => ({
      clearContent: () => log.push(["clear", name, row, column]),
      setFormula: (formula: string) => log.push(["set", name, row, column, formula]),
    }),
  };
}

/**
 * A sheet that records every call made on it and on any range it hands out.
 *
 * For the template test, which only needs to know what was written where.
 */
export function recordingSheet(name: string, log: { sheet: string; where: string; method: string; args: unknown[] }[]) {
  const range = (where: string): any =>
    new Proxy(
      {},
      {
        get: (_, method) => (...args: unknown[]) => {
          log.push({ sheet: name, where, method: String(method), args });
          return range(where);
        },
      }
    );
  return new Proxy(
    { name },
    {
      get: (target, method) => {
        if (method === "name") return target.name;
        return (...args: unknown[]) => {
          if (method === "getRange" || method === "getRangeList") return range(args.map(String).join(","));
          log.push({ sheet: name, where: "", method: String(method), args });
          return undefined;
        };
      },
    }
  );
}

/** A fresh context, fake server and stub services. */
export function harness() {
  const requests: Request[] = [];
  const routes: [string, RegExp, Handler][] = [];
  const cache = new Map<string, string>();
  const props = new Map<string, string>();
  const sleeps: number[] = [];
  const log: unknown[][] = [];
  const menus: { name: string; items: [string, string][] }[] = [];
  const held = new Set<string>();
  const state = { unreachable: false, salt: "" };
  const spreadsheet: any = {
    sheets: [] as any[],
    getId: () => SPREADSHEET_ID,
    getSheets: () => spreadsheet.sheets,
    getSheetByName: (name: string) => spreadsheet.sheets.find((s: any) => s.name === name) ?? null,
    insertSheet: (name: string, index: number) => {
      const sheet = spreadsheet.makeSheet(name);
      spreadsheet.sheets.splice(index, 0, sheet);
      return sheet;
    },
    setActiveSheet: (sheet: any) => log.push(["active", sheet.name]),
    makeSheet: (name: string) => ({ name }),
  };

  const on = (method: string, pattern: RegExp, handler: Handler) => routes.unshift([method, pattern, handler]);
  const idOf = (payload: any) => sha256(`${state.salt}${payload.decl}|${payload.log2 ?? 0}|${payload.bs ?? 0}`).slice(0, 16);
  const missing = (id: string): Answer => ({ status: 404, body: { detail: `object ${id} not in cache` } });
  /** An object route: 404 unless the server holds the id, else the answer. */
  const object = (answer: (request: Request, match: RegExpExecArray) => Answer): Handler => (request, match) =>
    held.has(match[1]) ? answer(request, match) : missing(match[1]);

  // The default server, registered last so a test's own `on` takes precedence.
  const defaults: [string, RegExp, Handler][] = [
    ["GET", /^\/v1\/meta$/, () => ({ status: 200, body: { version: "9.9.9", aggregate_version: "1.5.2" } })],
    [
      "POST",
      /^\/v1\/objects$/,
      (request) => {
        const decl: string = request.payload.decl;
        if (decl.includes("oops")) {
          return { status: 422, body: { detail: { line: 1, column: 7, message: "Unexpected 'oops'." } } };
        }
        if (decl.trim() === "(2+2)") return { status: 200, body: { kind: "value", value: 4 } };
        const [kind, name] = decl.trim().split(/\s+/);
        const id = idOf(request.payload);
        held.add(id);
        return { status: 200, body: { kind, name, id } };
      },
    ],
    ["GET", /^\/v1\/objects\/([0-9a-f]{16})\/exhibits$/, object(() => ({ status: 200, body: fixture("exhibits-basicbook") }))],
    [
      "GET",
      /^\/v1\/objects\/([0-9a-f]{16})\/exhibit\/([^/]+)$/,
      object((_, match) =>
        match[2] === "summary"
          ? { status: 200, body: fixture("summary-basicbook") }
          : { status: 404, body: { detail: `no exhibit '${match[2]}' for this object; available: ['summary']` } }
      ),
    ],
    [
      "GET",
      /^\/v1\/objects\/([0-9a-f]{16})\/quantiles$/,
      object((request) => {
        const ps = (request.query.get("p") ?? "").split(",").map(Number);
        return { status: 200, body: { quantiles: ps.map((p) => ({ p, q: p * 1000, snapped: p * 1000 })) } };
      }),
    ],
    ["GET", /^\/v1\/objects\/([0-9a-f]{16})\/frames$/, object(() => ({ status: 200, body: fixture("frames-aggregatestoploss") }))],
    [
      "GET",
      /^\/v1\/objects\/([0-9a-f]{16})\/frame\/([^/]+)\/shape$/,
      object((_, match) => {
        const frames = fixture("frames-aggregatestoploss").frames as { name: string; rows: number; columns: number }[];
        const frame = frames.find((f) => f.name === decodeURIComponent(match[2]));
        if (frame) return { status: 200, body: { rows: frame.rows, columns: frame.columns } };
        return { status: 404, body: { detail: `unknown frame '${match[2]}'; expected one of ['stats_df']` } };
      }),
    ],
    [
      "GET",
      /^\/v1\/examples$/,
      (request) => {
        const database = request.query.get("database");
        if (database && database !== "library") {
          return { status: 422, body: { detail: `unknown database '${database}'; GET /v1/examples/databases lists them` } };
        }
        return { status: 200, body: fixture("examples-few") };
      },
    ],
  ];

  const UrlFetchApp = {
    fetch(url: string, options: any = {}) {
      if (state.unreachable) throw new Error("Address unavailable: " + url);
      const parsed = new URL(url);
      const request: Request = {
        method: String(options.method ?? "get").toUpperCase(),
        path: parsed.pathname,
        query: parsed.searchParams,
        headers: { ...(options.headers ?? {}) },
        payload: options.payload ? JSON.parse(options.payload) : undefined,
      };
      requests.push(request);
      let answer: Answer = { status: 404, body: { detail: "Not Found" } };
      for (const [method, pattern, handler] of [...routes, ...defaults]) {
        const match = method === request.method ? pattern.exec(request.path) : null;
        const given = match ? handler(request, match) : undefined;
        if (given) {
          answer = given;
          break;
        }
      }
      return {
        getResponseCode: () => answer.status,
        getContentText: () =>
          answer.body === undefined ? "" : typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body),
        getHeaders: () => answer.headers ?? {},
      };
    },
  };

  const CacheService = {
    getDocumentCache: () => ({
      get: (key: string) => (cache.has(key) ? (cache.get(key) as string) : null),
      put: (key: string, value: string) => void cache.set(key, String(value)),
      putAll: (values: Record<string, string>) => {
        for (const [key, value] of Object.entries(values)) cache.set(key, String(value));
      },
    }),
  };

  const PropertiesService = {
    getDocumentProperties: () => ({
      getProperty: (key: string) => (props.has(key) ? (props.get(key) as string) : null),
      setProperty: (key: string, value: string) => void props.set(key, String(value)),
      deleteProperty: (key: string) => void props.delete(key),
      getKeys: () => [...props.keys()],
    }),
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => spreadsheet,
    flush: () => log.push(["flush"]),
    getUi: () => ({
      createMenu: (name: string) => {
        const menu = { name, items: [] as [string, string][] };
        const builder = {
          addItem: (caption: string, handler: string) => {
            menu.items.push([caption, handler]);
            return builder;
          },
          addToUi: () => void menus.push(menu),
        };
        return builder;
      },
    }),
  };

  const Utilities = {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    // Apps Script hands back signed bytes, -128 to 127.
    computeDigest: (_: string, text: string) =>
      [...createHash("sha256").update(text, "utf8").digest()].map((b) => (b > 127 ? b - 256 : b)),
    sleep: (ms: number) => void sleeps.push(ms),
  };

  const context = vm.createContext({ UrlFetchApp, CacheService, PropertiesService, SpreadsheetApp, Utilities });
  for (const file of ["core.js", "functions.js", "menu.js", "template.js"]) {
    vm.runInContext(readFileSync(new URL(file, DIST), "utf8"), context, { filename: file });
  }

  return {
    /** The script's globals: every AGG_ function and helper. */
    script: context as any,
    requests,
    cache,
    props,
    sleeps,
    log,
    menus,
    spreadsheet,
    on,
    /** Requests to `method` on a path matching `pattern`. */
    count: (method: string, pattern: RegExp) => requests.filter((r) => r.method === method && pattern.test(r.path)).length,
    /** The server loses every object, as on a restart. */
    restart: () => held.clear(),
    /** The server's library or versions change: the same program now gets a new id. */
    upgrade: () => {
      state.salt = "upgraded:";
      held.clear();
    },
    unreachable: () => {
      state.unreachable = true;
    },
    sha256,
  };
}
