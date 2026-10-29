/**
 * Native HTML forms against API routes (Meeko 1.7): the body of a `<form method="post">` as an
 * object, the conversion of its text guided by the route's schema, the destination of the `303`
 * and the single-use cookie that carries the outcome to the page the browser returns to.
 */
import { actionPathname, formFlashCookies, formFlashKey, parseFormFlash } from "../framework/form-flash.js";
import type { FormFlash, FormFlashSource } from "../framework/form-flash.js";
import { definePlugin } from "../framework/plugin.js";
import type { PluginRegistration } from "../framework/plugin.js";
import { themeReturnPath } from "../framework/theme-endpoint.js";
import { encodeBase64Url } from "./base64url.js";
import { currentRequest } from "./context.js";

/** A field of a native form: text, a file (only when the route accepts them) or a list of them. */
export type FormFieldValue = string | File | (string | File)[];

/** The two encodings of an HTML form; anything else is not a native form. */
export function formEncoding(request: Request): "urlencoded" | "multipart" | undefined {
  const type = (request.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (type === "application/x-www-form-urlencoded") return "urlencoded";
  if (type === "multipart/form-data") return "multipart";
  return undefined;
}

/** The fields of a native form, and the reserved `_csrf` and `return` fields apart. */
export interface ParsedForm {
  readonly fields: Record<string, FormFieldValue>;
  readonly csrf: string | undefined;
  readonly returnTo: string | undefined;
  /** A file arrived for a route that does not accept files. */
  readonly rejectedFile: boolean;
}

const reservedKeys = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Builds the object of a form: each name is a key; a repeated name or a name ending in `[]` is a
 * list. `_csrf` and `return` are taken apart. An empty file input (no file chosen) is left out.
 */
export function formObject(entries: Iterable<[string, FormDataEntryValue]>, files: boolean): ParsedForm {
  const fields: Record<string, FormFieldValue> = Object.create(null);
  let csrf: string | undefined;
  let returnTo: string | undefined;
  let rejectedFile = false;
  for (const [rawName, value] of entries) {
    if (rawName === "_csrf") { if (csrf === undefined && typeof value === "string") csrf = value; continue; }
    if (rawName === "return") { if (returnTo === undefined && typeof value === "string") returnTo = value; continue; }
    const list = rawName.endsWith("[]");
    const name = list ? rawName.slice(0, -2) : rawName;
    if (!name || reservedKeys.has(name)) continue;
    if (list && fields[name] === undefined) fields[name] = [];
    if (typeof value !== "string") {
      if (value.name === "" && value.size === 0) continue;
      if (!files) { rejectedFile = true; continue; }
    }
    const previous = fields[name];
    if (previous === undefined) fields[name] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else fields[name] = [previous, value];
  }
  return { fields, csrf, returnTo, rejectedFile };
}

const numberText = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function convertText(text: string): unknown {
  if (text === "") return undefined;
  if (text === "true" || text === "on") return true;
  if (text === "false") return false;
  if (numberText.test(text)) {
    const number = Number(text);
    if (Number.isFinite(number)) return number;
  }
  return text;
}

/**
 * The typed reading of a field whose text the schema rejected: `""` is `undefined` (an empty field
 * was not given), `"true"` and `"on"` (a checked checkbox) are `true`, `"false"` is `false`, a
 * decimal number is a `number`; in a list, each item, without the empty ones. Files stay.
 */
export function convertFormValue(value: FormFieldValue): unknown {
  if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? convertText(item) : item).filter((item) => item !== undefined);
  return typeof value === "string" ? convertText(value) : value;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  return Object.is(left, right);
}

/** The first key of an issue path joined with `.`; `""` for the whole form. */
export function issueRoot(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

/** What `planFormConversion` decided: the object of the second validation and its converted keys. */
export interface FormConversion {
  readonly value: Record<string, unknown>;
  readonly converted: ReadonlySet<string>;
}

/**
 * The second attempt of a form the schema rejected as text: only the fields with an issue (`roots`)
 * that have a typed reading different from their text are converted. `undefined` if none has one.
 */
export function planFormConversion(fields: Record<string, FormFieldValue>, roots: Iterable<string>): FormConversion | undefined {
  const value: Record<string, unknown> = Object.assign(Object.create(null), fields);
  const converted = new Set<string>();
  for (const root of roots) {
    if (!root || !Object.hasOwn(fields, root)) continue;
    const next = convertFormValue(fields[root]!);
    if (sameValue(next, fields[root])) continue;
    value[root] = next;
    converted.add(root);
  }
  return converted.size ? { value, converted } : undefined;
}

/** Field names whose values never travel back to the page: credentials and card codes. */
const secretName = /password|passcode|secret|token|cvc|cvv/i;

/**
 * The values a failed submission shows again: only the fields of `form.echo`, as text, numbers and
 * booleans, never files nor names that look like credentials. Without `echo`, none.
 */
export function echoValues(values: Readonly<Record<string, unknown>>, names: readonly string[]): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of new Set(names)) {
    if (!Object.hasOwn(values, key) || secretName.test(key)) continue;
    const value = values[key];
    const scalar = (item: unknown): boolean => typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item));
    if (scalar(value) || (Array.isArray(value) && value.every(scalar))) result[key] = value;
  }
  return result;
}

/**
 * A path of this origin for the `Location` of the `303`: the checks of `POST /_meeko/theme` (no
 * `//`, no `\`, no scheme nor control characters), so it never leaves the site. An absolute URL of
 * this same origin is accepted as its path. Anything else is `/`.
 */
export function sameOriginPath(value: string | undefined | null, origin: string): string {
  if (!value) return "/";
  if (value.startsWith("/")) return themeReturnPath(value, origin);
  let target: URL;
  try { target = new URL(value); }
  catch { return "/"; }
  if (target.origin !== origin) return "/";
  return themeReturnPath(`${target.pathname}${target.search}${target.hash}`, origin);
}

/** Where a failed submission returns: the `return` field, or this site's `Referer`, or `/`. */
export function formReturnPath(returnTo: string | undefined, request: Request): string {
  const origin = new URL(request.url).origin;
  if (returnTo !== undefined) return sameOriginPath(returnTo, origin);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.origin === origin) return sameOriginPath(`${url.pathname}${url.search}`, origin);
    } catch { /* A malformed Referer is not a destination. */ }
  }
  return "/";
}

/** The cookie name: `__Host-` over HTTPS, so no subdomain can plant it. */
function cookieName(request: Request): { readonly name: string; readonly secure: boolean } {
  const secure = new URL(request.url).protocol === "https:";
  return { name: secure ? formFlashCookies.secure : formFlashCookies.plain, secure };
}

/** A cookie a little under the 4 KiB that browsers keep. */
const maxCookieValue = 3600;

/** The flash of a page, base64url JSON: `p` is the pathname of the page that may read it. */
function encodeFlash(flash: FormFlash, path: string): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify({ v: 1, p: path, ...flash })));
}

/**
 * `Set-Cookie` of the flash for the page at `location`. The values go first and then the issues
 * when the cookie would not fit; the code always fits.
 */
export function formFlashCookie(request: Request, flash: FormFlash, location: string): string {
  const { name, secure } = cookieName(request);
  const path = new URL(location, request.url).pathname;
  let current: FormFlash = flash;
  let value = encodeFlash(current, path);
  if (value.length > maxCookieValue && current.values) {
    const { values: _values, ...rest } = current;
    current = rest;
    value = encodeFlash(current, path);
  }
  while (value.length > maxCookieValue && current.issues?.length) {
    current = { ...current, issues: current.issues.slice(0, -1) };
    value = encodeFlash(current, path);
  }
  return `${name}=${value}; Path=/; Max-Age=60; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

/** The `303 See Other` of a native form, never cached. */
export function seeOther(location: string, cookie: string): Response {
  return new Response(null, { status: 303, headers: { location, "set-cookie": cookie, "cache-control": "no-store" } });
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return undefined;
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return undefined; }
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const cookie of (header ?? "").split(";")) {
    const separator = cookie.indexOf("=");
    if (separator >= 0 && cookie.slice(0, separator).trim() === name) return cookie.slice(separator + 1).trim();
  }
  return undefined;
}

/**
 * The flash a `GET` of a page carries: from the cookie of a native submission, for this pathname.
 * Any other request, or a malformed or foreign cookie, has none.
 */
export function readFormFlash(request: Request): FormFlash | undefined {
  if (request.method !== "GET") return undefined;
  const raw = cookieValue(request.headers.get("cookie"), cookieName(request).name);
  if (!raw || raw.length > 4096) return undefined;
  const bytes = decodeBase64Url(raw);
  if (!bytes) return undefined;
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return undefined; }
  if (decoded === null || typeof decoded !== "object") return undefined;
  const { v, p } = decoded as { v?: unknown; p?: unknown };
  if (v !== 1 || p !== new URL(request.url).pathname) return undefined;
  const flash = parseFormFlash(decoded);
  return flash ? { ...flash, action: actionPathname(flash.action) } : undefined;
}

/** The page response that read the flash: the cookie is deleted and the response is never stored. */
export function consumeFormFlash(request: Request, response: Response): Response {
  const { name, secure } = cookieName(request);
  const headers = new Headers(response.headers);
  headers.append("set-cookie", `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * The built-in server plugin of `createServerApp`: publishes, for `useForm`, the flash of the page
 * request and the CSRF token of its session.
 */
export const formFlashPlugin: PluginRegistration = {
  name: "meeko:forms",
  plugin: definePlugin((app) => {
    const request = app.request;
    let csrfToken: string | undefined;
    try { csrfToken = currentRequest().context.session.current?.csrfToken; }
    catch { csrfToken = undefined; }
    const source: FormFlashSource = { flash: request ? readFormFlash(request) : undefined, csrfToken };
    app.provide(formFlashKey, source);
  }),
};
