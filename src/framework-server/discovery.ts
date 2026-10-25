import { readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequestContext } from "./context.js";
import type { RequestContext, ServerFetch } from "./context.js";
import { ApiError, dispatchApiRoute, dispatchRpc, errorResponse, reportServerError } from "./contracts.js";
import type { ApiRouteDefinition, RpcDefinition, Schema, ServerErrorObserver } from "./contracts.js";
import type { SessionManager } from "./sessions.js";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ApiEndpoint { readonly kind: "api"; readonly file: string; readonly pathname: string; readonly method: ApiMethod; readonly clientKey: string; }
export interface RpcEndpoint { readonly kind: "rpc"; readonly file: string; readonly pathname: string; readonly id: string; }
export interface SocketEndpoint { readonly kind: "socket"; readonly file: string; readonly name: string; readonly pathname: string; }
export interface ServerManifest { readonly api: readonly ApiEndpoint[]; readonly rpc: readonly RpcEndpoint[]; readonly socket?: readonly SocketEndpoint[]; }
type PatternPart = { kind: "static" | "param" | "rest"; value: string };

function parts(pathname: string): PatternPart[] {
  return pathname.split("/").filter(Boolean).map((part, index, all) => {
    if (/^\[\.\.\.[A-Za-z_$][\w$]*\]$/.test(part)) {
      if (index !== all.length - 1) throw new Error(`Catch-all must be last: ${pathname}`);
      return { kind: "rest", value: part.slice(4, -1) };
    }
    if (/^\[[A-Za-z_$][\w$]*\]$/.test(part)) return { kind: "param", value: part.slice(1, -1) };
    if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error(`Invalid server route segment: ${part}`);
    return { kind: "static", value: part };
  });
}

function collisionKey(pathname: string): string {
  return parts(pathname).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? "[]" : "[...]").join("/");
}

function clientKey(pathname: string): string {
  return parts(pathname).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? `by${part.value[0]!.toUpperCase()}${part.value.slice(1)}` : `by${part.value[0]!.toUpperCase()}${part.value.slice(1)}`).join(".");
}

/** A callable cannot also be the parent object of another generated client member. */
function assertCallablePaths(entries: readonly { readonly file: string; readonly path: string }[], label: string): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const [previousPath, previousFile] of seen) {
      if (entry.path !== previousPath && !entry.path.startsWith(`${previousPath}.`) && !previousPath.startsWith(`${entry.path}.`)) continue;
      throw new Error(`${label}: ${previousFile} (${previousPath}) and ${entry.file} (${entry.path}) cannot both be callable client paths`);
    }
    seen.set(entry.path, entry.file);
  }
}

async function files(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const file = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await files(file));
    else if (entry.isFile() && /\.(?:ts|js|mts|mjs)$/.test(entry.name) && !/\.(?:test|spec|d)\.(?:ts|js|mts|mjs)$/.test(entry.name)) found.push(file);
  }
  return found.sort();
}

function rel(root: string, file: string): string {
  return relative(root, file).split(sep).join("/").replace(/\.(?:ts|js|mts|mjs)$/, "");
}

function apiEndpoint(directory: string, file: string): ApiEndpoint {
  const path = rel(directory, file);
  const match = /^(.*)\.(get|post|put|patch|delete)$/.exec(path);
  if (!match) throw new Error(`API handler requires a method suffix: ${file}`);
  const route = match[1]!.split("/");
  if (route.at(-1) === "index") route.pop();
  if (route.length === 0) throw new Error(`API handler cannot target /api because it has no generated client key: ${file}`);
  const pathname = `/api${route.length ? `/${route.join("/")}` : ""}`;
  parts(pathname);
  return { kind: "api", file, pathname, method: match[2]!.toUpperCase() as ApiMethod, clientKey: clientKey(pathname.slice(4)) };
}

function rpcEndpoint(directory: string, file: string): RpcEndpoint {
  const path = rel(directory, file);
  const route = path.split("/");
  if (route.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) throw new Error(`Invalid RPC procedure name: ${file}`);
  const id = route.join(".");
  return { kind: "rpc", file, id, pathname: `/_meeko/rpc/${route.join("/")}` };
}

/** Static discovery is shared by development and production; no handler is executed here. */
export async function discoverServerManifest(projectRoot: string): Promise<ServerManifest> {
  const root = resolve(projectRoot);
  const apiRoot = join(root, "server", "api");
  const rpcRoot = join(root, "server", "rpc");
  const socketRoot = join(root, "server", "socket");
  const api = (await files(apiRoot)).map((file) => apiEndpoint(apiRoot, file));
  const rpc = (await files(rpcRoot)).map((file) => rpcEndpoint(rpcRoot, file));
  const socket = (await files(socketRoot)).map((file): SocketEndpoint => {
    const name = rel(socketRoot, file);
    if (!/^[A-Za-z_$][\w$-]*$/.test(name)) throw new Error(`Invalid Socket channel name in ${file}; use a single named file`);
    return { kind: "socket", file, name, pathname: `/_meeko/socket/${name}` };
  });
  const socketNames = new Map<string, string>();
  for (const endpoint of socket) {
    const previous = socketNames.get(endpoint.name);
    if (previous) throw new Error(`Socket channel collision: ${previous} and ${endpoint.file} both resolve to ${endpoint.name}`);
    socketNames.set(endpoint.name, endpoint.file);
  }
  const paths = new Map<string, string>();
  for (const endpoint of api) {
    const pathKey = `${endpoint.method} ${collisionKey(endpoint.pathname)}`;
    const previous = paths.get(pathKey);
    if (previous) throw new Error(`API route collision: ${previous} and ${endpoint.file} both resolve to ${pathKey}`);
    paths.set(pathKey, endpoint.file);
  }
  assertCallablePaths(api.map((endpoint) => ({ file: endpoint.file, path: `${endpoint.clientKey}.${endpoint.method.toLowerCase()}` })), "API client name collision");
  assertCallablePaths(rpc.map((endpoint) => ({ file: endpoint.file, path: endpoint.id })), "RPC collision");
  return Object.freeze({ api: Object.freeze(api), rpc: Object.freeze(rpc), socket: Object.freeze(socket) });
}

/** Loads server-only channel definitions; callers pass the result to createSocketHub. */
export async function loadSocketChannels(manifest: Pick<ServerManifest, "socket">, load: (file: string) => Promise<unknown> = async (file) => import(pathToFileURL(file).href) as Promise<unknown>): Promise<Readonly<Record<string, unknown>>> {
  const channels: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.socket ?? []) {
    const module = await load(endpoint.file);
    if (!module || typeof module !== "object" || !("default" in module)) throw new Error(`${endpoint.file}: Socket channel requires a default export`);
    channels[endpoint.name] = (module as { default: unknown }).default;
  }
  return channels;
}

function decode(part: string): string | undefined {
  try {
    const value = decodeURIComponent(part);
    return value && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\") ? value : undefined;
  } catch { return undefined; }
}

function match(pathname: string, pattern: string): Record<string, string> | undefined {
  const raw = pathname.split("/").filter(Boolean);
  const path = raw.map(decode);
  if (path.some((part) => part === undefined)) return undefined;
  const patternParts = parts(pattern);
  const params: Record<string, string> = Object.create(null);
  let index = 0;
  for (const part of patternParts) {
    if (part.kind === "rest") {
      if (index >= path.length) return undefined;
      params[part.value] = path.slice(index).join("/");
      index = path.length;
      break;
    }
    const value = path[index++];
    if (value === undefined || (part.kind === "static" && part.value !== value)) return undefined;
    if (part.kind === "param") params[part.value] = value;
  }
  return index === path.length ? params : undefined;
}

function rank(endpoint: ApiEndpoint): number[] {
  return parts(endpoint.pathname).map((part) => part.kind === "static" ? 3 : part.kind === "param" ? 2 : 1);
}

function compareApi(a: ApiEndpoint, b: ApiEndpoint): number {
  const left = rank(a);
  const right = rank(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const score = (right[index] ?? 0) - (left[index] ?? 0);
    if (score) return score;
  }
  return a.pathname.localeCompare(b.pathname);
}

export interface ServerDispatcherOptions<S = unknown> {
  manifest: ServerManifest;
  sessions: SessionManager;
  services: S | ((request: Request) => S | Promise<S>);
  load?: (file: string) => Promise<unknown>;
  /** Observes internal failures without exposing their details to clients. */
  onError?: ServerErrorObserver;
}

function exportedDefinition(module: unknown): unknown {
  if (module && typeof module === "object" && "default" in module) return (module as { default: unknown }).default;
  throw new ApiError("INVALID_HANDLER", 500);
}

/** Dispatches API and RPC through the same request context and security pipeline. */
function requestDispatcher<S>(options: Pick<ServerDispatcherOptions<S>, "manifest" | "sessions" | "load" | "onError">): (context: RequestContext<S>) => Promise<Response> {
  const api = [...options.manifest.api].sort(compareApi);
  const load = options.load ?? (async (file: string) => import(pathToFileURL(file).href) as Promise<unknown>);
  return async (context) => {
    const request = context.request;
    try {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/_meeko/rpc/")) {
        const endpoint = options.manifest.rpc.find((record) => record.pathname === pathname);
        if (!endpoint) throw new ApiError("NOT_FOUND", 404);
        if (request.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", 405);
        const definition = exportedDefinition(await load(endpoint.file)) as RpcDefinition<Schema, Schema, S>;
        return dispatchRpc(definition, context, options.sessions, options.onError);
      }
      let allowed: ApiMethod[] = [];
      for (const endpoint of api) {
        const params = match(pathname, endpoint.pathname);
        if (!params) continue;
        if (request.method !== endpoint.method) { allowed.push(endpoint.method); continue; }
        const definition = exportedDefinition(await load(endpoint.file)) as ApiRouteDefinition<Schema | undefined, Schema | undefined, Schema | undefined, Schema | undefined, S>;
        return dispatchApiRoute(definition, context, options.sessions, params, options.onError);
      }
      if (allowed.length) {
        const response = errorResponse(new ApiError("METHOD_NOT_ALLOWED", 405), context.requestId);
        response.headers.set("allow", [...new Set(allowed)].join(", "));
        return response;
      }
      throw new ApiError("NOT_FOUND", 404);
    } catch (error) { reportServerError(error, context.requestId, options.onError); return errorResponse(error, context.requestId); }
  };
}

export function createServerDispatcher<S>(options: ServerDispatcherOptions<S>): (request: Request) => Promise<Response> {
  const dispatch = requestDispatcher(options);
  return async (request) => {
    let requestId: string = randomUUID();
    try {
      const session = await options.sessions.load(request);
      const services = typeof options.services === "function" ? await (options.services as (request: Request) => S | Promise<S>)(request) : options.services;
      const context = createRequestContext(request, services, session);
      requestId = context.requestId;
      return dispatch(context);
    } catch (error) { reportServerError(error, requestId, options.onError); return errorResponse(error, requestId); }
  };
}

/** SSR dispatch reuses the original session, services, state and request ID. */
export function createLocalServerFetch<S>(options: Pick<ServerDispatcherOptions<S>, "manifest" | "sessions" | "load" | "onError">): ServerFetch {
  const dispatch = requestDispatcher(options);
  return async (request, active) => {
    const source = active.request;
    if (new URL(request.url).origin !== new URL(source.url).origin) {
      return errorResponse(new ApiError("INVALID_ORIGIN", 403), active.requestId);
    }
    for (const name of ["cookie", "authorization"]) {
      if (request.headers.get(name) !== source.headers.get(name)) {
        return errorResponse(new ApiError("INVALID_CREDENTIALS", 403), active.requestId);
      }
    }
    const context: RequestContext<S> = { ...active, request, signal: request.signal } as RequestContext<S>;
    return dispatch(context);
  };
}
