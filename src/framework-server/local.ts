import { pathToFileURL } from "node:url";
import { ApiError, dispatchApiRoute, dispatchRpc, errorResponse, reportServerError } from "./contracts.js";
import type { ApiRouteDefinition, RpcDefinition, Schema, ServerErrorObserver } from "./contracts.js";
import type { RequestContext } from "./context.js";
import type { ApiMethod, ServerManifest } from "./discovery.js";
import type { SessionManager } from "./sessions.js";
import { serializeJson } from "../server.js";

export interface LocalCallOptions<S> {
  manifest: ServerManifest;
  context: RequestContext<S>;
  sessions: SessionManager;
  load?: (file: string) => Promise<unknown>;
  onError?: ServerErrorObserver;
}

export interface LocalApiInput {
  params?: Readonly<Record<string, string>>;
  query?: Readonly<Record<string, string | number | boolean | readonly string[] | null | undefined>>;
  body?: unknown;
}

function publicHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of ["cookie", "origin", "x-meeko-csrf", "authorization"]) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function resolvePath(pattern: string, params: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const path = pattern.split("/").map((part) => {
    const match = /^\[([A-Za-z_$][\w$]*)\]$/.exec(part);
    const rest = /^\[\.\.\.([A-Za-z_$][\w$]*)\]$/.exec(part);
    if (!match && !rest) return part;
    const key = (match ?? rest)![1]!;
    const value = params[key];
    if (!value) throw new ApiError("INVALID_PARAMS", 400);
    used.add(key);
    if (rest) {
      const segments = value.split("/");
      if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw new ApiError("INVALID_PARAMS", 400);
      return segments.map(encodeURIComponent).join("/");
    }
    if (value.includes("/") || value === "." || value === "..") throw new ApiError("INVALID_PARAMS", 400);
    return encodeURIComponent(value);
  }).join("/");
  for (const key of Object.keys(params)) if (!used.has(key)) throw new ApiError("INVALID_PARAMS", 400);
  return path;
}

function routeModule(module: unknown): unknown {
  if (module && typeof module === "object" && "default" in module) return (module as { default: unknown }).default;
  throw new ApiError("INVALID_HANDLER", 500);
}

/** Local calls use in-memory Request objects, never a network fetch or global context. */
export function createLocalCalls<S>(options: LocalCallOptions<S>) {
  const load = options.load ?? (async (file: string) => import(pathToFileURL(file).href) as Promise<unknown>);
  const derived = (request: Request): RequestContext<S> => ({ ...options.context, request });
  return {
    async api(clientKey: string, method: ApiMethod, input: LocalApiInput = {}): Promise<Response> {
      try {
        const endpoint = options.manifest.api.find((entry) => entry.clientKey === clientKey && entry.method === method);
        if (!endpoint) throw new ApiError("NOT_FOUND", 404);
        const url = new URL(resolvePath(endpoint.pathname, input.params ?? {}), options.context.request.url);
        for (const [key, value] of Object.entries(input.query ?? {})) {
          if (value === undefined || value === null) continue;
          if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
          else url.searchParams.set(key, String(value));
        }
        const headers = publicHeaders(options.context.request);
        if ((method === "GET") && Object.hasOwn(input, "body")) throw new ApiError("INVALID_BODY", 400);
        const body = Object.hasOwn(input, "body") ? serializeJson(input.body) : undefined;
        if (body !== undefined) headers.set("content-type", "application/json");
        const request = new Request(url, { method, headers, signal: options.context.signal, ...(body === undefined ? {} : { body }) });
        const definition = routeModule(await load(endpoint.file)) as ApiRouteDefinition<Schema | undefined, Schema | undefined, Schema | undefined, Schema | undefined, S>;
        return dispatchApiRoute(definition, derived(request), options.sessions, input.params ?? {}, options.onError);
      } catch (error) { reportServerError(error, options.context.requestId, options.onError); return errorResponse(error, options.context.requestId); }
    },
    async rpc(id: string, input: unknown): Promise<Response> {
      try {
        const endpoint = options.manifest.rpc.find((entry) => entry.id === id);
        if (!endpoint) throw new ApiError("NOT_FOUND", 404);
        const headers = publicHeaders(options.context.request);
        headers.set("content-type", "application/json");
        const request = new Request(new URL(endpoint.pathname, options.context.request.url), {
          method: "POST", headers, signal: options.context.signal, body: serializeJson(input),
        });
        const definition = routeModule(await load(endpoint.file)) as RpcDefinition<Schema, Schema, S>;
        return dispatchRpc(definition, derived(request), options.sessions, options.onError);
      } catch (error) { reportServerError(error, options.context.requestId, options.onError); return errorResponse(error, options.context.requestId); }
    },
  };
}
