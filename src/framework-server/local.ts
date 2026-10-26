import { ApiError, dispatchApiRoute, dispatchRpc, errorResponse, reportServerError } from "./contracts.js";
import type { ApiRouteDefinition, RpcDefinition, Schema, ServerErrorObserver } from "./contracts.js";
import type { RequestContext } from "./context.js";
import type { ApiMethod, ServerManifest, ServerModuleLoader } from "./discovery.js";
import type { SessionManager } from "./sessions.js";
import { serializeJson } from "../server.js";

/**
 * Opciones de {@link createLocalCalls}.
 *
 * @typeParam S Tipo de los servicios.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import type { LocalCallOptions } from "@meekojs/meeko/server";
 *
 * const options: LocalCallOptions<unknown> = { manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) };
 * ```
 */
export interface LocalCallOptions<S> {
  /** Manifiesto con los endpoints. */
  manifest: ServerManifest;
  /** Contexto de la petición original, cuyas credenciales se reutilizan. */
  context: RequestContext<S>;
  /** Gestor de sesiones. */
  sessions: SessionManager;
  /** Resuelve cada clave del manifiesto a su módulo de handler. */
  load: ServerModuleLoader;
  /** Observador de los fallos internos. */
  onError?: ServerErrorObserver;
}

/**
 * Entrada de una llamada local a la API con `createLocalCalls().api`.
 *
 * @example
 * ```ts
 * import type { LocalApiInput } from "@meekojs/meeko/server";
 *
 * const input: LocalApiInput = { params: { id: "123" }, query: { tab: "profile" } };
 * const response = await calls.api("users.byId", "GET", input);
 * ```
 */
export interface LocalApiInput {
  /** Parámetros de la ruta. */
  params?: Readonly<Record<string, string>>;
  /** Query string; omite `null` y `undefined`. */
  query?: Readonly<Record<string, string | number | boolean | readonly string[] | null | undefined>>;
  /** Cuerpo JSON; no se admite en `GET`. */
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

/**
 * Crea funciones para llamar a la API y al RPC de la aplicación dentro del proceso, con objetos
 * `Request` en memoria y las credenciales de la petición original, sin red ni contexto global. Las
 * respuestas pasan por las mismas guardas y normalización de errores.
 *
 * @param options Manifiesto, contexto, sesiones y cargador.
 * @returns `{ api(clientKey, method, input?), rpc(id, input) }`, que devuelven un `Response` y nunca rechazan.
 * @throws {TypeError} Si falta el cargador.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import { createLocalCalls } from "@meekojs/meeko/server";
 *
 * const calls = createLocalCalls({ manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) });
 * const user = await (await calls.api("users.byId", "GET", { params: { id: "123" } })).json();
 * const result = await (await calls.rpc("users.get", { id: "123" })).json();
 * ```
 */
export function createLocalCalls<S>(options: LocalCallOptions<S>) {
  if (typeof options.load !== "function") throw new TypeError("Local calls require a module loader");
  const load = options.load;
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
