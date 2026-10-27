import { createRequestContext } from "./context.js";
import type { RequestContext, ServerFetch } from "./context.js";
import { ApiError, dispatchApiRoute, dispatchRpc, errorResponse, reportServerError } from "./contracts.js";
import type { ApiRouteDefinition, RpcDefinition, Schema, ServerErrorObserver } from "./contracts.js";
import type { ServerPlatform } from "./platform.js";
import type { SessionManager } from "./sessions.js";

/**
 * Método HTTP de un endpoint de API, el sufijo de `server/api/<ruta>.<método>.ts`.
 *
 * @example
 * ```ts
 * import type { ApiMethod } from "@meekojs/meeko/server";
 *
 * const safe = (method: ApiMethod): boolean => method === "GET";
 * ```
 */
export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
/**
 * Endpoint de API descubierto en `server/api`.
 *
 * @example
 * ```ts
 * import type { ApiEndpoint } from "@meekojs/meeko/server";
 *
 * const endpoint: ApiEndpoint = { kind: "api", file: "/server/api/users/[id].get.ts", pathname: "/api/users/[id]", method: "GET", clientKey: "users.byId" };
 * ```
 */
export interface ApiEndpoint {
  /** Tipo de entrada. */
  readonly kind: "api";
  /** Clave del módulo del handler para el cargador. */
  readonly file: string;
  /** Ruta HTTP con los segmentos dinámicos entre corchetes. */
  readonly pathname: string;
  /** Método HTTP. */
  readonly method: ApiMethod;
  /** Ruta del método en el cliente `api`, separada por puntos. */
  readonly clientKey: string;
}
/**
 * Procedimiento RPC descubierto en `server/rpc`.
 *
 * @example
 * ```ts
 * import type { RpcEndpoint } from "@meekojs/meeko/server";
 *
 * const procedure: RpcEndpoint = { kind: "rpc", file: "/server/rpc/users/get.ts", pathname: "/_meeko/rpc/users/get", id: "users.get" };
 * ```
 */
export interface RpcEndpoint {
  /** Tipo de entrada. */
  readonly kind: "rpc";
  /** Clave del módulo del handler para el cargador. */
  readonly file: string;
  /** Ruta HTTP bajo `/_meeko/rpc`. */
  readonly pathname: string;
  /** ID del procedimiento con puntos. */
  readonly id: string;
}
/**
 * Canal Socket descubierto en `server/socket`.
 *
 * @example
 * ```ts
 * import type { SocketEndpoint } from "@meekojs/meeko/server";
 *
 * const chat: SocketEndpoint = { kind: "socket", file: "/server/socket/chat.ts", name: "chat", pathname: "/_meeko/socket/chat" };
 * ```
 */
export interface SocketEndpoint {
  /** Tipo de entrada. */
  readonly kind: "socket";
  /** Clave del módulo del canal para el cargador. */
  readonly file: string;
  /** Nombre del canal. */
  readonly name: string;
  /** Ruta del upgrade WebSocket bajo `/_meeko/socket`. */
  readonly pathname: string;
}
/**
 * Endpoints del servidor: API, RPC y Socket. Los archivos son claves opacas que se pasan al cargador
 * de módulos del host. Lo produce `discoverServerManifest` de `@meekojs/meeko/build`.
 *
 * @example
 * ```ts
 * import type { ServerManifest } from "@meekojs/meeko/server";
 *
 * const manifest: ServerManifest = {
 *   api: [{ kind: "api", file: "/server/api/health.get.ts", pathname: "/api/health", method: "GET", clientKey: "health" }],
 *   rpc: [],
 *   socket: [],
 * };
 * ```
 */
export interface ServerManifest {
  /** Endpoints de API. */
  readonly api: readonly ApiEndpoint[];
  /** Procedimientos RPC. */
  readonly rpc: readonly RpcEndpoint[];
  /** Canales Socket. */
  readonly socket?: readonly SocketEndpoint[];
}
/**
 * Resuelve una clave del manifiesto a su módulo. Los bundlers lo proporcionan desde un mapa estático
 * de módulos; en Node puede ser `import()`.
 *
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import type { ServerModuleLoader } from "@meekojs/meeko/server";
 *
 * const load: ServerModuleLoader = (file) => import(pathToFileURL(file).href);
 * ```
 */
export type ServerModuleLoader = (file: string) => Promise<unknown>;
type PatternPart = { kind: "static" | "param" | "rest"; value: string };

export function parts(pathname: string): PatternPart[] {
  return pathname.split("/").filter(Boolean).map((part, index, all) => {
    if (/^\[\.\.\.[A-Za-z_$][\w$]*\]$/.test(part)) {
      if (index !== all.length - 1) throw new Error(`El segmento catch-all debe ser el último: ${pathname}`);
      return { kind: "rest", value: part.slice(4, -1) };
    }
    if (/^\[[A-Za-z_$][\w$]*\]$/.test(part)) return { kind: "param", value: part.slice(1, -1) };
    if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error(`Segmento de ruta del servidor no válido: ${part}`);
    return { kind: "static", value: part };
  });
}

export function collisionKey(pathname: string): string {
  return parts(pathname).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? "[]" : "[...]").join("/");
}

export function clientKey(pathname: string): string {
  return parts(pathname).map((part) => part.kind === "static" ? part.value : part.kind === "param" ? `by${part.value[0]!.toUpperCase()}${part.value.slice(1)}` : `by${part.value[0]!.toUpperCase()}${part.value.slice(1)}`).join(".");
}

/** A callable cannot also be the parent object of another generated client member. */
export function assertCallablePaths(entries: readonly { readonly file: string; readonly path: string }[], label: string): void {
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const [previousPath, previousFile] of seen) {
      if (entry.path !== previousPath && !entry.path.startsWith(`${previousPath}.`) && !previousPath.startsWith(`${entry.path}.`)) continue;
      throw new Error(`${label}: ${previousFile} (${previousPath}) y ${entry.file} (${entry.path}) no pueden ser a la vez rutas invocables del cliente`);
    }
    seen.set(entry.path, entry.file);
  }
}

/**
 * Carga las definiciones de los canales Socket del manifiesto, que sólo existen en el servidor. El
 * resultado se pasa a `createSocketHub`.
 *
 * @param manifest Manifiesto con la lista `socket`.
 * @param load Cargador de módulos.
 * @returns Las definiciones por nombre de canal.
 * @throws {TypeError} Si falta el cargador.
 * @throws {Error} Si un módulo de canal no tiene export por defecto.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import { createSocketHub, loadSocketChannels } from "@meekojs/meeko/server";
 *
 * const channels = await loadSocketChannels(manifest, (file) => import(pathToFileURL(file).href));
 * const hub = createSocketHub({ channels, sessions, services: {} });
 * ```
 */
export async function loadSocketChannels(manifest: Pick<ServerManifest, "socket">, load: ServerModuleLoader): Promise<Readonly<Record<string, unknown>>> {
  if (typeof load !== "function") throw new TypeError("loadSocketChannels requires a module loader");
  const channels: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.socket ?? []) {
    const module = await load(endpoint.file);
    if (!module || typeof module !== "object" || !("default" in module)) throw new Error(`${endpoint.file}: el canal Socket requiere un export por defecto`);
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

/**
 * Opciones de {@link createServerDispatcher} y {@link createLocalServerFetch}.
 *
 * @typeParam S Tipo de los servicios.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import type { ServerDispatcherOptions } from "@meekojs/meeko/server";
 *
 * const options: ServerDispatcherOptions<{ startedAt: number }> = {
 *   manifest,
 *   sessions,
 *   services: () => ({ startedAt: Date.now() }),
 *   load: (file) => import(pathToFileURL(file).href),
 *   onError: (error, requestId) => console.error(requestId, error),
 * };
 * ```
 */
export interface ServerDispatcherOptions<S = unknown> {
  /** Manifiesto con los endpoints. */
  manifest: ServerManifest;
  /** Gestor de sesiones. */
  sessions: SessionManager;
  /** Servicios compartidos o una función que los crea en cada petición. */
  services: S | ((request: Request) => S | Promise<S>);
  /** Resuelve cada clave del manifiesto; obligatorio para que el despachador nunca lea el disco. */
  load: ServerModuleLoader;
  /** Runtime que se expone en `RequestContext.platform`. */
  platform?: ServerPlatform;
  /** Observa los fallos internos sin exponer sus detalles a los clientes. */
  onError?: ServerErrorObserver;
}

function exportedDefinition(module: unknown): unknown {
  if (module && typeof module === "object" && "default" in module) return (module as { default: unknown }).default;
  throw new ApiError("INVALID_HANDLER", 500);
}

/** Dispatches API and RPC through the same request context and security pipeline. */
export function createContextDispatcher<S>(options: Pick<ServerDispatcherOptions<S>, "manifest" | "sessions" | "load" | "onError">): (context: RequestContext<S>) => Promise<Response> {
  if (typeof options.load !== "function") throw new TypeError("Server dispatch requires a module loader");
  const api = [...options.manifest.api].sort(compareApi);
  const load = options.load;
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

/**
 * Crea un handler HTTP que atiende `/api/...` y `/_meeko/rpc/...` para un host propio: carga la
 * sesión, crea el contexto y despacha con las mismas guardas, validaciones y normalización de
 * errores que la aplicación. Responde `404` o `405` (con `Allow`) cuando no hay endpoint.
 *
 * @param options Manifiesto, sesiones, servicios y cargador.
 * @returns Un handler `(request) => Promise<Response>` que nunca rechaza.
 * @throws {TypeError} Si falta el cargador.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import { createServerDispatcher } from "@meekojs/meeko/server";
 *
 * const dispatch = createServerDispatcher({ manifest, sessions, services: {}, load: (file) => import(pathToFileURL(file).href) });
 * const response = await dispatch(new Request("http://localhost/api/users"));
 * ```
 */
export function createServerDispatcher<S>(options: ServerDispatcherOptions<S>): (request: Request) => Promise<Response> {
  const dispatch = createContextDispatcher(options);
  return async (request) => {
    let requestId: string = crypto.randomUUID();
    try {
      const session = await options.sessions.load(request);
      const services = typeof options.services === "function" ? await (options.services as (request: Request) => S | Promise<S>)(request) : options.services;
      const context = createRequestContext(request, services, session, options.platform);
      requestId = context.requestId;
      return dispatch(context);
    } catch (error) { reportServerError(error, requestId, options.onError); return errorResponse(error, requestId); }
  };
}

/**
 * Crea el despacho local que usan los clientes de servidor durante SSR: atiende las llamadas a API
 * y RPC por el mismo pipeline sin salir del proceso y reutiliza la sesión, los servicios, el
 * estado y el `requestId` de la petición original. Rechaza con `403` las peticiones de otro
 * origen o con otras credenciales.
 *
 * @param options Manifiesto, sesiones y cargador.
 * @returns La {@link ServerFetch} local.
 * @throws {TypeError} Si falta el cargador.
 * @example
 * ```ts
 * import { pathToFileURL } from "node:url";
 * import { createLocalServerFetch } from "@meekojs/meeko/server";
 *
 * const serverFetch = createLocalServerFetch({ manifest, sessions, load: (file) => import(pathToFileURL(file).href) });
 * // Mismo origen y mismas credenciales que la petición original.
 * const request = new Request(new URL("/api/users", context.request.url), { headers: context.request.headers });
 * const response = await serverFetch(request, context);
 * ```
 */
export function createLocalServerFetch<S>(options: Pick<ServerDispatcherOptions<S>, "manifest" | "sessions" | "load" | "onError">): ServerFetch {
  const dispatch = createContextDispatcher(options);
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
