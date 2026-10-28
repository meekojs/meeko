// Development only: what server code writes with `console.*` while it serves a request reaches the
// browser console too, marked as the server's. Only `meeko dev` imports this module; the build, the
// production servers and the client bundle never do.
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { inspect, types } from "node:util";
import type { Plugin } from "vite";
import { normalizeAddress, socketAddressOf } from "../framework-server/env.js";

/** `console` methods whose calls are forwarded. */
export const serverLogLevels = ["log", "info", "warn", "error", "debug"] as const;
export type ServerLogLevel = typeof serverLogLevels[number];

/** One `console.*` call: its level and its arguments in the wire form of {@link serializeLogArguments}. */
export interface ServerLogEntry {
  readonly level: ServerLogLevel;
  readonly args: readonly unknown[];
}

/**
 * The logs of one request that travel together: in the document (`<script data-meeko-server-logs>`),
 * in a navigation payload (`devServerLogs`) or over Vite's HMR channel (`meeko:server-logs`).
 * `phase: "late"` marks logs written after the response was complete, such as `waitUntil` work.
 */
export interface ServerLogBatch {
  readonly requestId?: string;
  readonly method: string;
  readonly path: string;
  readonly phase: "request" | "late";
  readonly entries: readonly ServerLogEntry[];
  /** Entries left out once the request reached {@link serverLogLimits}. */
  readonly omitted?: number;
}

/** HMR event of the batches that cannot travel in a response. */
export const serverLogsEvent = "meeko:server-logs";
/** Key of a navigation payload that carries the logs of its request. */
export const serverLogsPayloadKey = "devServerLogs";
/** Attribute of the `<script type="application/json">` blocks with the logs of a document. */
export const serverLogsAttribute = "data-meeko-server-logs";
/** Vite id of the browser module that prints the logs. */
const clientModuleId = "\0meeko:server-logs";
/** URL of that module, as Vite serves a virtual module. */
export const serverLogsClientUrl = "/@id/__x00__meeko:server-logs";
/** Vite id of the classic script that keeps the browser's own `console` methods. */
const consoleModuleId = "\0meeko:server-logs-console";
/**
 * URL of that script. A classic script in `<head>` runs while the parser reads it, before Vite's
 * client (a module) wraps `console` to forward the browser's logs to the terminal
 * (`server.forwardConsole`): printing through the wrapper would send each server log back to the
 * terminal that already showed it.
 */
export const serverLogsConsoleUrl = "/@id/__x00__meeko:server-logs-console";
/** Global under which that script leaves the methods. */
const consoleKey = "meeko.server-logs.console";
const consoleSource = `(() => {
  const key = Symbol.for(${JSON.stringify(consoleKey)});
  if (globalThis[key]) return;
  const methods = {};
  for (const name of ["log", "info", "warn", "error", "debug", "group", "groupEnd"]) methods[name] = console[name].bind(console);
  globalThis[key] = methods;
})();
`;

/** Bounds of what one value, one call and one request may send to the browser. */
export const serverLogLimits = {
  /** Nesting below which objects become a one-line summary, such as `[Object]`. */
  depth: 8,
  /** Properties of an object, items of an array, `Set` or `Map` sent; the rest is counted. */
  items: 100,
  /** Characters of a string sent; the rest is counted. */
  string: 10_000,
  /** Values serialized per call; later ones become `…`. */
  nodes: 5_000,
  /** Calls kept per request while its response is still being written. */
  entries: 500,
  /** JSON characters kept per request while its response is still being written. */
  bytes: 1_000_000,
} as const;

interface EncodeState {
  readonly ids: Map<object, number>;
  next: number;
  nodes: number;
}

/** Calls `read` and turns a throw into a summary: a getter, a proxy or a broken `toString` must not break the log. */
function attempt<T>(read: () => T, fallback: (error: unknown) => T): T {
  try { return read(); }
  catch (error) { return fallback(error); }
}

function text(value: string): { $: "text"; text: string } {
  return { $: "text", text: value };
}

function encodeString(value: string): string {
  if (value.length <= serverLogLimits.string) return value;
  return `${value.slice(0, serverLogLimits.string)}… (+${value.length - serverLogLimits.string} caracteres)`;
}

/** Name of the class of an object, without running getters; `null` for a null prototype, `undefined` for a plain object. */
function constructorName(value: object): string | null | undefined {
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype === null) return null;
  if (prototype === Object.prototype) return undefined;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value as unknown;
  return typeof constructor === "function" && typeof constructor.name === "string" && constructor.name ? constructor.name : undefined;
}

function summary(value: object): string {
  if (Array.isArray(value)) return `[Array(${value.length})]`;
  if (types.isMap(value)) return `[Map(${value.size})]`;
  if (types.isSet(value)) return `[Set(${value.size})]`;
  if (types.isNativeError(value) || value instanceof Error) return `[${attempt(() => String((value as Error).name), () => "Error")}]`;
  return `[${constructorName(value) ?? "Object"}]`;
}

/** Own enumerable string keys with their values; an accessor is described, never called. */
function ownEntries(value: object, depth: number, state: EncodeState, skip?: ReadonlySet<string>): { entries: [string, unknown][]; more: number } {
  const keys = Object.keys(value).filter((key) => !skip?.has(key));
  const entries: [string, unknown][] = [];
  for (const key of keys.slice(0, serverLogLimits.items)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (descriptor.get || descriptor.set) {
      entries.push([key, text(descriptor.get && descriptor.set ? "[Getter/Setter]" : descriptor.get ? "[Getter]" : "[Setter]")]);
    } else entries.push([key, encode(descriptor.value, depth + 1, state)]);
  }
  return { entries, more: Math.max(0, keys.length - serverLogLimits.items) };
}

const errorKeys: ReadonlySet<string> = new Set(["name", "message", "stack", "cause", "errors"]);

function encodeObject(value: object, depth: number, state: EncodeState): unknown {
  const known = state.ids.get(value);
  if (known !== undefined) return { $: "ref", id: known };
  // util.inspect reads a proxy's target without running its traps.
  if (types.isProxy(value)) return text(inspect(value, { depth: 2, breakLength: Infinity }));
  if (types.isDate(value)) {
    const time = Date.prototype.getTime.call(value);
    return { $: "date", v: Number.isNaN(time) ? null : new Date(time).toISOString() };
  }
  if (types.isRegExp(value)) return { $: "regexp", source: (value as RegExp).source, flags: (value as RegExp).flags };
  if (types.isBoxedPrimitive(value)) return text(inspect(value));
  // Binary data, promises, weak collections, generators: Node's one-line description.
  if (ArrayBuffer.isView(value) || types.isAnyArrayBuffer(value) || types.isPromise(value) || types.isWeakMap(value) || types.isWeakSet(value)
    || types.isGeneratorObject(value) || types.isModuleNamespaceObject(value)) {
    return text(inspect(value, { depth: 0, maxArrayLength: 20, maxStringLength: 200, breakLength: Infinity }));
  }
  if (depth >= serverLogLimits.depth) return text(summary(value));
  const id = state.next++;
  state.ids.set(value, id);
  if (types.isNativeError(value) || value instanceof Error) {
    const error = value as Error & { cause?: unknown; errors?: unknown };
    const stack = attempt(() => error.stack, () => undefined);
    const hasCause = attempt(() => "cause" in error, () => false);
    const errors = attempt(() => error.errors, () => undefined);
    const own = ownEntries(error, depth, state, errorKeys);
    return {
      $: "error", id,
      name: encodeString(attempt(() => String(error.name), () => "Error")),
      message: encodeString(attempt(() => String(error.message), () => "")),
      ...(typeof stack === "string" ? { stack: encodeString(stack) } : {}),
      ...(hasCause ? { cause: encode(attempt(() => error.cause, (failure) => failure), depth + 1, state) } : {}),
      ...(Array.isArray(errors) ? { errors: errors.slice(0, serverLogLimits.items).map((item) => encode(item, depth + 1, state)) } : {}),
      ...(own.entries.length ? { entries: own.entries } : {}),
    };
  }
  if (Array.isArray(value)) {
    const items: unknown[] = [];
    const length = value.length;
    for (let index = 0; index < Math.min(length, serverLogLimits.items); index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, index);
      items.push(!descriptor ? { $: "undefined" } : descriptor.get || descriptor.set ? text("[Getter]") : encode(descriptor.value, depth + 1, state));
    }
    return { $: "array", id, items, ...(length > serverLogLimits.items ? { more: length - serverLogLimits.items } : {}) };
  }
  if (types.isMap(value)) {
    const entries: [unknown, unknown][] = [];
    let index = 0;
    for (const [key, item] of Map.prototype.entries.call(value) as IterableIterator<[unknown, unknown]>) {
      if (index++ >= serverLogLimits.items) break;
      entries.push([encode(key, depth + 1, state), encode(item, depth + 1, state)]);
    }
    const size = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!.call(value) as number;
    return { $: "map", id, entries, ...(size > serverLogLimits.items ? { more: size - serverLogLimits.items } : {}) };
  }
  if (types.isSet(value)) {
    const items: unknown[] = [];
    let index = 0;
    for (const item of Set.prototype.values.call(value) as IterableIterator<unknown>) {
      if (index++ >= serverLogLimits.items) break;
      items.push(encode(item, depth + 1, state));
    }
    const size = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!.call(value) as number;
    return { $: "set", id, items, ...(size > serverLogLimits.items ? { more: size - serverLogLimits.items } : {}) };
  }
  const own = ownEntries(value, depth, state);
  const name = constructorName(value);
  return {
    $: "object", id, entries: own.entries,
    ...(name === undefined ? {} : { ctor: name }),
    ...(own.more ? { more: own.more } : {}),
  };
}

function encode(value: unknown, depth: number, state: EncodeState): unknown {
  if (++state.nodes > serverLogLimits.nodes) return text("…");
  switch (typeof value) {
    case "string": return encodeString(value);
    case "number": return Number.isFinite(value) && !Object.is(value, -0) ? value : { $: "number", v: Object.is(value, -0) ? "-0" : String(value) };
    case "boolean": return value;
    case "undefined": return { $: "undefined" };
    case "bigint": return { $: "bigint", v: value.toString() };
    case "symbol": return { $: "symbol", ...(value.description === undefined ? {} : { v: encodeString(value.description) }) };
    case "function": {
      const source = attempt(() => Function.prototype.toString.call(value), () => "");
      return { $: "function", name: attempt(() => typeof value.name === "string" ? value.name : "", () => ""), ...(/^class[\s{]/.test(source) ? { class: true } : {}) };
    }
  }
  if (value === null) return null;
  return attempt(() => encodeObject(value as object, depth, state), (error) => text(`[No serializable: ${attempt(() => error instanceof Error ? error.message : String(error), () => "error")}]`));
}

/**
 * Wire form of the arguments of one `console` call, as JSON that the browser turns back into
 * values: strings, finite numbers, booleans and `null` as they are; any other value as
 * `{ $: type, ... }`. Objects, arrays, `Map`, `Set` and errors carry an `id`, and a value met again
 * (a cycle or a shared reference) is `{ $: "ref", id }`. Getters are never called, proxies never
 * trapped, and {@link serverLogLimits} bounds depth, width and size. Never throws.
 */
export function serializeLogArguments(args: readonly unknown[]): unknown[] {
  const state: EncodeState = { ids: new Map(), next: 0, nodes: 0 };
  return args.map((value) => attempt(() => encode(value, 0, state), () => text("[No serializable]")));
}

/** JSON for a `<script type="application/json">` block: nothing in it can close the element or open a comment. */
export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function isLoopbackAddress(address: string | undefined): boolean {
  const normalized = address === undefined ? undefined : normalizeAddress(address);
  return normalized !== undefined && (normalized === "::1" || /^127\./.test(normalized));
}

function isLocalHostname(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  const lower = bare.toLowerCase();
  return lower === "localhost" || lower.endsWith(".localhost") || isLoopbackAddress(lower);
}

/**
 * Headers that a proxy or a tunnel adds (ngrok, cloudflared, VS Code dev tunnels, Tailscale, a
 * reverse proxy). They reach this server from loopback, so the socket address alone cannot tell
 * the developer's browser from a remote visitor of the tunnel.
 */
const proxyHeaders = [
  "forwarded", "via", "x-real-ip", "x-client-ip", "true-client-ip", "x-cluster-client-ip", "x-original-host",
  "cf-connecting-ip", "cf-connecting-ipv6", "cf-ray", "fastly-client-ip", "x-envoy-external-address",
] as const;

function isProxied(headers: Headers): boolean {
  if (proxyHeaders.some((name) => headers.has(name))) return true;
  for (const name of headers.keys()) if (name.startsWith("x-forwarded-")) return true;
  return false;
}

/**
 * The hostname of the `Host` header the browser sent: `request.url` takes the public origin when
 * there is one, so it cannot tell which name the browser used.
 */
function requestHostname(request: Request): string | undefined {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  try { return new URL(`http://${host}`).hostname; }
  catch { return undefined; }
}

/**
 * Whether a request comes from a browser on this machine: it arrives from a loopback address,
 * without the headers of a proxy or a tunnel, and names a loopback host (`localhost`,
 * `*.localhost`, `127.0.0.0/8`, `[::1]`). The host of `MEEKO_PUBLIC_ORIGIN` is never trusted: it
 * is the name a tunnel or a proxy publishes.
 */
function isDeveloperRequest(request: Request): boolean {
  if (!isLoopbackAddress(socketAddressOf(request)) || isProxied(request.headers)) return false;
  const hostname = requestHostname(request);
  return hostname !== undefined && isLocalHostname(hostname);
}

/** Sends a batch to the browsers; `undefined` while there is no HMR channel. */
export type ServerLogsChannel = () => { send(event: string, payload?: unknown): void } | undefined;

/** The logs of one request; a request's async work, also after its response, writes here. */
class RequestLogs {
  private entries: ServerLogEntry[] = [];
  private size = 0;
  private omitted = 0;
  /** While `true` the logs wait for the response; afterwards they go over HMR. */
  private buffering = true;
  private scheduled = false;
  requestId: string | undefined;

  constructor(readonly method: string, readonly path: string, private readonly channel: ServerLogsChannel) {}

  add(level: ServerLogLevel, args: readonly unknown[]): void {
    const entry: ServerLogEntry = { level, args: serializeLogArguments(args) };
    const size = JSON.stringify(entry).length;
    if (this.entries.length >= serverLogLimits.entries || this.size + size > serverLogLimits.bytes) {
      this.omitted++;
    } else {
      this.entries.push(entry);
      this.size += size;
    }
    if (!this.buffering) this.schedule();
  }

  get pending(): boolean { return this.entries.length > 0 || this.omitted > 0; }

  /** The logs gathered so far, emptied, or `undefined` when there are none. */
  take(phase: ServerLogBatch["phase"] = "request"): ServerLogBatch | undefined {
    if (!this.pending) return undefined;
    const batch: ServerLogBatch = {
      ...(this.requestId ? { requestId: this.requestId } : {}),
      method: this.method, path: this.path, phase, entries: this.entries,
      ...(this.omitted ? { omitted: this.omitted } : {}),
    };
    this.entries = [];
    this.size = 0;
    this.omitted = 0;
    return batch;
  }

  /** The response is complete: what is left, and what comes later, goes over HMR. */
  release(): void {
    if (!this.buffering) return;
    this.buffering = false;
    this.send(this.take("request"));
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    // Outside the request: whatever the send logs is not captured again.
    storage.exit(() => setImmediate(() => {
      this.scheduled = false;
      this.send(this.take("late"));
    }));
  }

  private send(batch: ServerLogBatch | undefined): void {
    if (!batch) return;
    muted++;
    try { this.channel()?.send(serverLogsEvent, batch); }
    catch { /* The browser misses these logs; the terminal already has them. */ }
    finally { muted--; }
  }
}

const storage = new AsyncLocalStorage<RequestLogs>();
/** Non-zero while this module itself writes, so that a log of its own is not captured. */
let muted = 0;
let installs = 0;
const patched = new Map<ServerLogLevel, { readonly original: (...args: unknown[]) => void; readonly wrapper: (...args: unknown[]) => void }>();

/** Wraps the `console` methods once per process; the last {@link uninstallConsole} restores them. */
function installConsole(): void {
  if (installs++ > 0) return;
  for (const level of serverLogLevels) {
    const original = console[level] as (...args: unknown[]) => void;
    const wrapper = function (this: unknown, ...args: unknown[]): void {
      try { original.apply(this, args); }
      finally {
        const logs = muted ? undefined : storage.getStore();
        if (logs) {
          muted++;
          try { logs.add(level, args); }
          catch { /* The terminal already has the log. */ }
          finally { muted--; }
        }
      }
    };
    patched.set(level, { original, wrapper });
    console[level] = wrapper;
  }
}

function uninstallConsole(): void {
  if (installs === 0 || --installs > 0) return;
  for (const [level, { original, wrapper }] of patched) {
    // Someone wrapped it after us: theirs stays, and ours, now unused by any server, only forwards.
    if (console[level] === wrapper) console[level] = original;
  }
  patched.clear();
}

/** Responses whose body may carry the logs: an HTML document or a navigation payload. */
function deliveryOf(response: Response): "html" | "payload" | "ndjson" | undefined {
  if (!response.body || response.headers.has("content-encoding")) return undefined;
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (type.startsWith("text/html")) return "html";
  if (type.startsWith("application/meeko+json")) return "payload";
  if (type.startsWith("application/meeko+ndjson")) return "ndjson";
  return undefined;
}

function rebuilt(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

function logsBlock(batch: ServerLogBatch | undefined): string {
  return batch ? `<script type="application/json" ${serverLogsAttribute}>${jsonForHtml(batch)}</script>` : "";
}

/** Adds `devServerLogs` to the JSON object of a payload or an ndjson line. */
function withPayloadLogs(json: string, batch: ServerLogBatch | undefined): string {
  if (!batch) return json;
  const end = json.lastIndexOf("}");
  if (end < 0) return json;
  const before = json.slice(0, end).trimEnd();
  return `${before}${before.endsWith("{") ? "" : ","}${JSON.stringify(serverLogsPayloadKey)}:${JSON.stringify(batch)}${json.slice(end)}`;
}

/**
 * Rewrites a body as text, chunk by chunk: `edit` returns what to send for each decoded chunk and
 * `end` what is left at the end. `done` runs once, when the body ends, fails or is cancelled; a
 * cancellation reaches the original body, which stops its producer (deferred values, a stream).
 */
function rewriteBody(body: ReadableStream<Uint8Array>, edit: (chunk: string) => string, end: () => string, done: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    done();
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) {
            const rest = edit(decoder.decode()) + end();
            if (rest) controller.enqueue(encoder.encode(rest));
            controller.close();
            finish();
            return;
          }
          const text = edit(decoder.decode(chunk.value, { stream: true }));
          if (text) {
            controller.enqueue(encoder.encode(text));
            return;
          }
        }
      } catch (error) {
        finish();
        controller.error(error);
      }
    },
    async cancel(reason) {
      finish();
      await reader.cancel(reason);
    },
  });
}

/** Escapes a value for a double-quoted HTML attribute. */
function attributeValue(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * The nonce that lets the injected scripts run: the one of the response's `Content-Security-Policy`
 * for scripts (`script-src-elem`, `script-src` or `default-src`, in that order), or else the
 * `nonce` attribute of a `<script>` of the head, which the document writes when
 * `DocumentOptions.nonce` returns one (Vite's client carries it in `meeko dev`).
 */
function documentNonce(policy: string | null, head: string): string | undefined {
  if (policy) {
    const directives = new Map<string, string>();
    for (const directive of policy.split(/[;,]/)) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources.join(" "));
    }
    for (const name of ["script-src-elem", "script-src", "default-src"]) {
      const sources = directives.get(name);
      if (sources === undefined) continue;
      const nonce = /'nonce-([^']+)'/i.exec(sources)?.[1];
      if (nonce) return nonce;
      break;
    }
  }
  const attribute = /<script\b[^>]*?\snonce\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(head);
  const value = attribute?.[1] ?? attribute?.[2] ?? attribute?.[3];
  // The attribute is already HTML-escaped; it is decoded for one escaping only.
  return value ? value.replace(/&(amp|lt|gt|quot|#39|#34);/g, (_match, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#34": '"' })[name]!) : undefined;
}

/** Marker of the payload script, the first element after the hydrated `#app` root. */
const payloadMarker = '<script id="meeko-payload"';

/**
 * The document gets the browser module and the logs gathered so far before `</head>`; later logs
 * (streaming, deferred values) go before `</body>` or after a chunk that ends with `</script>` once
 * the payload script has closed, never inside `#app`, which the browser hydrates; those after the
 * end go over HMR.
 */
function htmlWithLogs(body: ReadableStream<Uint8Array>, logs: RequestLogs, policy: string | null): ReadableStream<Uint8Array> {
  let head = "";
  let headDone = false;
  /** 0 before the payload script, 1 inside it, 2 after it: only then a chunk end is outside `#app`. */
  let stage: 0 | 1 | 2 = 0;
  /** The end of the previous chunk, for a marker split between two chunks. */
  let carry = "";
  const advance = (chunk: string): void => {
    if (stage === 2) return;
    let text = carry + chunk;
    if (stage === 0) {
      const at = text.indexOf(payloadMarker);
      if (at < 0) { carry = text.slice(-payloadMarker.length); return; }
      stage = 1;
      text = text.slice(at + payloadMarker.length);
    }
    // The payload JSON escapes `<`, so its first `</script` closes it.
    if (/<\/script\s*>/i.test(text)) { stage = 2; carry = ""; }
    else carry = text.slice(-9);
  };
  const late = (chunk: string): string => {
    advance(chunk);
    if (!logs.pending) return chunk;
    const end = chunk.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
    if (end >= 0) return chunk.slice(0, end) + logsBlock(logs.take()) + chunk.slice(end);
    return stage === 2 && /<\/script>\s*$/i.test(chunk) ? chunk + logsBlock(logs.take()) : chunk;
  };
  const withHead = (chunk: string, final: boolean): string => {
    head += chunk;
    const end = head.search(/<\/head\s*>/i);
    if (end < 0 && !final && head.length < 1 << 20) return "";
    headDone = true;
    const text = head;
    head = "";
    // A document without </head> keeps its markup; its logs go over HMR.
    if (end < 0) return text;
    const nonce = documentNonce(policy, text.slice(0, end));
    const nonceAttribute = nonce ? ` nonce="${attributeValue(nonce)}"` : "";
    const script = `<script${nonceAttribute} src="${serverLogsConsoleUrl}"></script><script type="module" async${nonceAttribute} src="${serverLogsClientUrl}"></script>`;
    return text.slice(0, end) + logsBlock(logs.take()) + script + late(text.slice(end));
  };
  return rewriteBody(body, (chunk) => headDone ? late(chunk) : withHead(chunk, false), () => headDone ? "" : withHead("", true), () => logs.release());
}

/** The first line carries the logs of the render; each later line those written since. */
function ndjsonWithLogs(body: ReadableStream<Uint8Array>, logs: RequestLogs): ReadableStream<Uint8Array> {
  let partial = "";
  return rewriteBody(body, (chunk) => {
    partial += chunk;
    const end = partial.lastIndexOf("\n");
    if (end < 0) return "";
    const lines = partial.slice(0, end).split("\n");
    partial = partial.slice(end + 1);
    return lines.map((line) => line.trim() ? withPayloadLogs(line, logs.take()) : line).join("\n") + "\n";
  }, () => {
    const rest = partial;
    partial = "";
    return rest;
  }, () => logs.release());
}

/** Capture and delivery of the server logs of one `meeko dev` server, closed with it. */
export interface DevServerLogs {
  /**
   * Serves `request` with `respond` while recording its `console` calls; the response carries
   * them when it comes from the developer's browser, otherwise they go over HMR.
   */
  handle(request: Request, respond: () => Promise<Response>): Promise<Response>;
  /** Vite plugin that serves the browser modules that print the logs. */
  readonly plugin: Plugin;
  /** Restores `console` when no other server uses the capture. Idempotent. */
  close(): void;
}

/** Options of {@link createDevServerLogs}. */
export interface DevServerLogsOptions {
  /** Current HMR channel: Vite replaces `server.ws` on restart. */
  readonly hot: ServerLogsChannel;
}

/** Source of the browser module: the compiled file next to this one, or its TypeScript when run from the sources. */
async function clientSource(): Promise<string> {
  // The map of the compiled file would resolve against the virtual module's URL.
  try { return (await readFile(new URL("./dev-server-logs-client.js", import.meta.url), "utf8")).replace(/^\/\/# sourceMappingURL=.*$/m, ""); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const source = await readFile(new URL("./dev-server-logs-client.ts", import.meta.url), "utf8");
  const { transformWithOxc } = await import("vite");
  return (await transformWithOxc(source, "dev-server-logs-client.ts")).code;
}

/**
 * Installs the `console` capture of a `meeko dev` server. Calls made while a request is served,
 * also from its async work, belong to that request; calls outside every request (startup, Vite,
 * file watching, Socket callbacks) stay in the terminal only.
 */
export function createDevServerLogs(options: DevServerLogsOptions): DevServerLogs {
  installConsole();
  let closed = false;
  return {
    async handle(request, respond) {
      if (closed) return respond();
      const url = new URL(request.url);
      const logs = new RequestLogs(request.method, url.pathname + url.search, options.hot);
      let response: Response;
      try { response = await storage.run(logs, respond); }
      catch (error) {
        logs.release();
        throw error;
      }
      logs.requestId = response.headers.get("x-request-id") ?? undefined;
      // A HEAD request has no body, and a browser elsewhere on the network or behind a tunnel gets
      // nothing: its logs go over HMR, which only listens on loopback.
      const delivery = request.method === "HEAD" || !isDeveloperRequest(request) ? undefined : deliveryOf(response);
      if (delivery === "html") return rebuilt(response, htmlWithLogs(response.body!, logs, response.headers.get("content-security-policy")));
      if (delivery === "ndjson") return rebuilt(response, ndjsonWithLogs(response.body!, logs));
      if (delivery !== "payload") {
        logs.release();
        return response;
      }
      try { return rebuilt(response, withPayloadLogs(await response.text(), logs.take())); }
      finally { logs.release(); }
    },
    plugin: {
      name: "meeko:server-logs",
      apply: "serve",
      resolveId(id) { return id === clientModuleId || id === consoleModuleId ? id : undefined; },
      async load(id) {
        if (id === consoleModuleId) return consoleSource;
        if (id !== clientModuleId) return undefined;
        return `${await clientSource()}\nstartServerLogs(import.meta.hot, window, globalThis[Symbol.for(${JSON.stringify(consoleKey)})] ?? console);\n`;
      },
    },
    close() {
      if (closed) return;
      closed = true;
      uninstallConsole();
    },
  };
}
