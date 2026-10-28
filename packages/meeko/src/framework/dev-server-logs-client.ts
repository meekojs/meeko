// Browser module of the server logs of `meeko dev`. The dev server reads this file and serves it
// as a Vite virtual module, so it must stay self-contained: no imports, no Node APIs. It is never
// part of the client build.

/** The part of `import.meta.hot` this module uses. */
export interface ServerLogsHot {
  on(event: string, listener: (data: unknown) => void): void;
}

/** A batch as the dev server sends it (see `ServerLogBatch` in `dev-server-logs.ts`). */
interface Batch {
  readonly requestId?: string;
  readonly method: string;
  readonly path: string;
  readonly phase: "request" | "late";
  readonly entries: readonly { readonly level: string; readonly args: readonly unknown[] }[];
  readonly omitted?: number;
}

type WireNode = { readonly $: string; readonly [key: string]: unknown };

const badge = "background:#0f766e;color:#fff;border-radius:3px;padding:0 4px;font-weight:600";
const muted = "color:#64748b;font-weight:normal";
const levels = new Set(["log", "info", "warn", "error", "debug"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBatch(value: unknown): value is Batch {
  return isRecord(value) && typeof value.method === "string" && typeof value.path === "string" && Array.isArray(value.entries);
}

/** One class per server class name, so DevTools shows `User {…}` for a `User` of the server. */
const classes = new Map<string, new () => object>();

function namedObject(name: string | null | undefined): Record<string, unknown> {
  if (name === null) return Object.create(null) as Record<string, unknown>;
  if (name === undefined) return {};
  let constructor = classes.get(name);
  if (!constructor) {
    constructor = ({ [name]: class {} })[name]!;
    classes.set(name, constructor);
  }
  return Object.create(constructor.prototype) as Record<string, unknown>;
}

function define(target: object, key: PropertyKey, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/** Turns the wire form back into values the console can expand: objects, `Map`, `Set`, errors with the server stack. */
function revive(node: unknown, refs: Map<number, unknown>): unknown {
  if (Array.isArray(node)) return node.map((item) => revive(item, refs));
  if (!isRecord(node) || typeof node.$ !== "string") return node;
  const wire = node as WireNode;
  const id = typeof wire.id === "number" ? wire.id : undefined;
  const register = <T>(value: T): T => {
    if (id !== undefined) refs.set(id, value);
    return value;
  };
  const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
  switch (wire.$) {
    case "undefined": return undefined;
    case "number": return Number(wire.v);
    case "bigint": {
      try { return BigInt(String(wire.v)); }
      catch { return `${String(wire.v)}n`; }
    }
    case "symbol": return typeof wire.v === "string" ? Symbol(wire.v) : Symbol();
    case "function": {
      const name = typeof wire.name === "string" ? wire.name : "";
      return wire.class ? ({ [name]: class {} })[name] : ({ [name]: function () {} })[name];
    }
    case "date": return typeof wire.v === "string" ? new Date(wire.v) : new Date(Number.NaN);
    case "regexp": {
      try { return new RegExp(String(wire.source), String(wire.flags)); }
      catch { return `/${String(wire.source)}/${String(wire.flags)}`; }
    }
    case "text": return String(wire.text);
    case "ref": return refs.get(Number(wire.id));
    case "error": {
      const error = register(new Error(String(wire.message ?? "")));
      define(error, "name", String(wire.name ?? "Error"));
      // DevTools prints an error by its `stack` text: the server's, with the server's files and lines.
      define(error, "stack", typeof wire.stack === "string" ? wire.stack : `${String(wire.name)}: ${String(wire.message)}`);
      if ("cause" in wire) define(error, "cause", revive(wire.cause, refs));
      if (Array.isArray(wire.errors)) define(error, "errors", wire.errors.map((item) => revive(item, refs)));
      for (const entry of list(wire.entries)) {
        if (Array.isArray(entry)) define(error, String(entry[0]), revive(entry[1], refs));
      }
      return error;
    }
    case "array": {
      const array = register([] as unknown[]);
      for (const item of list(wire.items)) array.push(revive(item, refs));
      if (typeof wire.more === "number") array.push(`… (+${wire.more})`);
      return array;
    }
    case "map": {
      const map = register(new Map<unknown, unknown>());
      for (const entry of list(wire.entries)) {
        if (Array.isArray(entry)) map.set(revive(entry[0], refs), revive(entry[1], refs));
      }
      if (typeof wire.more === "number") map.set("…", `+${wire.more}`);
      return map;
    }
    case "set": {
      const set = register(new Set<unknown>());
      for (const item of list(wire.items)) set.add(revive(item, refs));
      if (typeof wire.more === "number") set.add(`… (+${wire.more})`);
      return set;
    }
    case "object": {
      const object = register(namedObject(typeof wire.ctor === "string" || wire.ctor === null ? wire.ctor : undefined));
      for (const entry of list(wire.entries)) {
        if (Array.isArray(entry)) define(object, String(entry[0]), revive(entry[1], refs));
      }
      if (typeof wire.more === "number") define(object, "…", `+${wire.more}`);
      return object;
    }
    default: return node;
  }
}

/**
 * Arguments for `console[level]`: the `server` badge first. A string first argument keeps its
 * format directives (`%s`, `%o`, `%c`…), as in the terminal.
 */
export function serverLogArguments(args: readonly unknown[]): unknown[] {
  const refs = new Map<number, unknown>();
  const values = args.map((arg) => revive(arg, refs));
  if (typeof values[0] === "string") return [`%cserver%c ${values[0]}`, badge, "", ...values.slice(1)];
  return ["%cserver", badge, ...values];
}

/** Prints a batch as a console group labelled with the request; never throws. */
export function printServerLogs(batch: unknown, target: Console = console): void {
  if (!isBatch(batch)) return;
  try {
    const id = batch.requestId ? ` ${batch.requestId.slice(0, 8)}` : "";
    const late = batch.phase === "late" ? " (después de la respuesta)" : "";
    target.group(`%cserver%c ${batch.method} ${batch.path}%c${id}${late}`, badge, "font-weight:600", muted);
    try {
      for (const entry of batch.entries) {
        const level = levels.has(entry.level) ? entry.level as "log" | "info" | "warn" | "error" | "debug" : "log";
        try { target[level](...serverLogArguments(Array.isArray(entry.args) ? entry.args : [])); }
        catch { target.log("%cserver%c (log ilegible)", badge, muted); }
      }
      if (batch.omitted) target.warn(`%cserver%c ${batch.omitted} logs más de esta petición sólo están en la terminal`, badge, "");
    } finally {
      target.groupEnd();
    }
  } catch {
    // A broken console must not break the page.
  }
}

/** Marks the scripts already printed. */
const printed = new WeakSet<Element>();

function readBlocks(document: Document, target: Console): void {
  for (const script of Array.from(document.querySelectorAll('script[type="application/json"][data-meeko-server-logs]'))) {
    if (printed.has(script)) continue;
    let batch: unknown;
    // Text still arriving is not JSON yet; the next mutation or DOMContentLoaded reads it again.
    try { batch = JSON.parse(script.textContent ?? ""); }
    catch { continue; }
    printed.add(script);
    printServerLogs(batch, target);
  }
}

/** Navigation payloads carry their logs in `devServerLogs`, the first ndjson line and later ones too. */
function watchNavigation(scope: Window & typeof globalThis, target: Console): void {
  const original = scope.fetch;
  if (typeof original !== "function") return;
  const wrapped = async (...args: Parameters<typeof fetch>): Promise<Response> => {
    const response = await original.apply(scope, args);
    try {
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      if (type.startsWith("application/meeko+json")) {
        // Read before the router does, so the server's logs come before what the new page logs.
        const text = await response.clone().text();
        const payload = JSON.parse(text) as Record<string, unknown>;
        printServerLogs(payload.devServerLogs, target);
      } else if (type.startsWith("application/meeko+ndjson") && response.body) {
        return readingLines(response, target);
      }
    } catch {
      // The router reports a malformed payload itself.
    }
    return response;
  };
  scope.fetch = wrapped as typeof fetch;
}

/**
 * The same streamed response, printing the logs of each line as the router reads it. Unlike a
 * clone, it passes a cancellation on: leaving the route still stops the server's deferred work.
 */
function readingLines(response: Response, target: Console): Response {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let partial = "";
  const line = (text: string): void => {
    if (!text.includes('"devServerLogs"')) return;
    try { printServerLogs((JSON.parse(text) as Record<string, unknown>).devServerLogs, target); }
    catch { /* Not a line of Meeko's. */ }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch (error) {
        controller.error(error);
        return;
      }
      if (chunk.done) {
        line(partial + decoder.decode());
        controller.close();
        return;
      }
      partial += decoder.decode(chunk.value, { stream: true });
      let end: number;
      while ((end = partial.indexOf("\n")) >= 0) {
        line(partial.slice(0, end));
        partial = partial.slice(end + 1);
      }
      controller.enqueue(chunk.value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  const passed = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  // The router reads where a followed redirect ended.
  for (const key of ["url", "redirected", "type"] as const) Object.defineProperty(passed, key, { value: response[key] });
  return passed;
}

const started = Symbol.for("meeko.server-logs");

/**
 * Prints the logs of the server in the browser console: the blocks of the document (also those a
 * stream adds later), the logs of each navigation payload and the batches that arrive over HMR.
 */
export function startServerLogs(hot: ServerLogsHot | undefined, scope: Window & typeof globalThis = window, target: Console = scope.console): void {
  const marker = scope as unknown as Record<symbol, boolean>;
  if (marker[started]) return;
  marker[started] = true;
  const document = scope.document;
  readBlocks(document, target);
  if (document.readyState === "loading") {
    // A streamed document is still arriving: its later blocks are read as the parser adds them.
    const observer = new scope.MutationObserver(() => readBlocks(document, target));
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener("DOMContentLoaded", () => {
      observer.disconnect();
      readBlocks(document, target);
    }, { once: true });
  }
  watchNavigation(scope, target);
  hot?.on("meeko:server-logs", (batch) => printServerLogs(batch, target));
}
