import { AsyncLocalStorage } from "node:async_hooks";
import type { RouteMiddleware } from "../framework/middleware.js";
import type { ErrorPageRecord, RouteRecord } from "../framework/router.js";
import { createPageHandler, withRouteManifest } from "../framework/server.js";
import type { DocumentMarkup, DocumentOptions, PageHandlerOptions, PageModule, PageRoute, PrerenderSource } from "../framework/server.js";
import { escapeHtml } from "../server.js";
import type { AssetManifest, AssetReader } from "./assets.js";
import { createRequestContext } from "./context.js";
import type { RequestContext } from "./context.js";
import { errorResponse, observeServerError, reportServerError } from "./contracts.js";
import type { ServerErrorObserver } from "./contracts.js";
import { createContextDispatcher, createLocalServerFetch, loadSocketChannels } from "./discovery.js";
import type { ServerManifest } from "./discovery.js";
import { composeServerMiddleware } from "./middleware.js";
import type { ServerMiddleware } from "./middleware.js";
import { createDetachedPlatform } from "./platform.js";
import type { ServerPlatform } from "./platform.js";
import type { ServerRuntime, ServerRuntimeDefinition } from "./runtime.js";
import { MemorySessionStore, SessionManager } from "./sessions.js";
import { createSocketHub } from "./socket.js";
import type { SocketHub, SocketPubSub } from "./socket.js";

/**
 * Archivos del build cliente que enlaza cada documento renderizado en el servidor.
 *
 * @example
 * ```ts
 * import type { ClientAssets } from "@meekojs/meeko/server";
 *
 * const client: ClientAssets = {
 *   entry: "/assets/entry-client-4f2a.js",
 *   css: ["/assets/main-91bc.css"],
 *   preload: ["/assets/runtime-0d3e.js"],
 * };
 * ```
 */
export interface ClientAssets {
  /** URL del módulo de entrada del cliente. */
  readonly entry: string;
  /** Hojas de estilo enlazadas en `<head>`. */
  readonly css: readonly string[];
  /** Imports estáticos de la entrada, anunciados con `modulepreload`. */
  readonly preload: readonly string[];
}

/**
 * Todo lo que el servidor necesita para enrutar peticiones, fijado en el build. Los archivos son
 * claves de módulo relativas al proyecto, como `/app/pages/index.meeko`.
 *
 * @example
 * ```ts
 * import type { AppManifest } from "@meekojs/meeko/server";
 *
 * const manifest: AppManifest = {
 *   version: 1,
 *   routes: [{ id: "/", file: "/app/pages/index.meeko", layouts: ["/app/app.meeko"] }],
 *   errorPage: { file: "/app/error.meeko", layouts: ["/app/app.meeko"] },
 *   server: { api: [], rpc: [], socket: [] },
 *   routeMiddleware: [],
 *   serverMiddleware: ["/server/middleware/10-headers.ts"],
 *   client: { entry: "/assets/entry.js", css: [], preload: [] },
 * };
 * ```
 */
export interface AppManifest {
  /** Versión del formato. */
  readonly version: 1;
  /** Manifiesto de rutas. */
  readonly routes: readonly RouteRecord[];
  /**
   * `app/error.meeko` y sus layouts raíz; renderiza las URL sin ruta.
   * @since 1.1.0
   */
  readonly errorPage?: ErrorPageRecord | undefined;
  /** Endpoints de API, procedimientos RPC y canales Socket. */
  readonly server: ServerManifest;
  /** Módulos de `app/middleware`, en orden de ejecución. */
  readonly routeMiddleware: readonly string[];
  /** Módulos de `server/middleware`, en orden de ejecución. */
  readonly serverMiddleware: readonly string[];
  /** Archivos del build cliente. */
  readonly client: ClientAssets;
  /** Archivos públicos del build; en desarrollo los sirve Vite. */
  readonly assets?: AssetManifest;
}

/**
 * Resuelve una clave del manifiesto a su módulo.
 *
 * @example
 * ```ts
 * import type { AppModuleLoader } from "@meekojs/meeko/server";
 *
 * const modules = import.meta.glob(["/app/**", "/server/**"]);
 * const load: AppModuleLoader = (key) => modules[key]?.() ?? Promise.reject(new Error(`Unknown module ${key}`));
 * ```
 */
export type AppModuleLoader = (key: string) => Promise<unknown>;

/**
 * Opciones de {@link createServerApp}.
 *
 * @typeParam Env Tipo de las variables o bindings del entorno.
 * @example
 * ```ts
 * import { createServerApp } from "@meekojs/meeko/server";
 * import type { ServerAppOptions } from "@meekojs/meeko/server";
 * import { load, manifest, runtime } from "virtual:meeko-server-app";
 *
 * const options: ServerAppOptions = {
 *   manifest, load, runtime,
 *   production: true,
 *   platform: { name: "node", env: process.env, waitUntil: () => {} },
 *   publicOrigin: "https://example.com",
 * };
 * const app = await createServerApp(options);
 * ```
 */
export interface ServerAppOptions<Env = Readonly<Record<string, string | undefined>>> {
  /** Manifiesto fijado en el build. */
  readonly manifest: AppManifest;
  /** Cargador de módulos por clave del manifiesto. */
  readonly load: AppModuleLoader;
  /** Export por defecto de `server/runtime.ts`; sin él sólo hay sesiones en memoria de desarrollo. */
  readonly runtime?: ServerRuntimeDefinition<Env, any> | undefined;
  /** Modo producción: exige un runtime con store persistente y oculta los detalles de los errores. */
  readonly production: boolean;
  /** Plataforma que recibe la fábrica del runtime y que se usa cuando `fetch` no recibe otra. */
  readonly platform?: ServerPlatform<Env>;
  /** Lector de los archivos públicos del build. */
  readonly assets?: AssetReader;
  /** Páginas prerenderizadas; sus URL se sirven sin loader ni render. */
  readonly prerender?: PrerenderSource;
  /** Añadidos del host a cada documento HTML. */
  readonly document?: DocumentOptions;
  /** Sustituye a `ServerRuntime.publicOrigin`. */
  readonly publicOrigin?: string;
  /** Lo activa `meeko build` mientras prerenderiza páginas. */
  readonly prerendering?: boolean;
  /** Broker de Socket si el runtime no declara ninguno, como el de Durable Objects en Cloudflare. */
  readonly defaultSocketPubSub?: SocketPubSub;
}

/**
 * Socket de una aplicación con canales: lo que necesita un adaptador para aceptar conexiones.
 *
 * @example
 * ```ts
 * if (app.socket) {
 *   const { hub, pathnamePrefix } = app.socket;
 *   await hub.broadcast("chat", "general", "message", { text: "Mantenimiento en 5 minutos" });
 *   console.log(`Socket en ${pathnamePrefix}/<canal>`);
 * }
 * ```
 */
export interface ServerAppSocket {
  /** Hub que valida y reparte los mensajes. */
  readonly hub: SocketHub;
  /** Prefijo de las rutas de los canales, `/_meeko/socket`. */
  readonly pathnamePrefix: string;
  /** Tamaño máximo de un mensaje entrante en bytes. */
  readonly maxMessageBytes?: number;
  /** Broker del hub; no existe cuando usa su propio `LocalSocketPubSub`. */
  readonly pubsub?: SocketPubSub;
  /** Nombre de la cookie de sesión, para hosts que sólo conservan esa cookie con la conexión. */
  readonly sessionCookieName?: string;
}

/**
 * Aplicación portable: cada adaptador traduce sus peticiones a `fetch`. La crea
 * {@link createServerApp}.
 *
 * @example
 * ```ts
 * const response = await app.fetch(new Request("http://localhost/api/health"));
 * console.log(response.status);
 * await app.close();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#runtime-de-servidor
 */
export interface ServerApp {
  /** Atiende una petición: middleware, assets, páginas, API y RPC. */
  fetch(request: Request, platform?: ServerPlatform): Promise<Response>;
  /** Existe cuando la aplicación declara canales Socket. */
  readonly socket?: ServerAppSocket;
  /** Manifiesto de la aplicación. */
  readonly manifest: AppManifest;
  /** Origen público con el que se comprueba `Origin`. */
  readonly publicOrigin?: string;
  /** Envía un fallo del transporte al mismo observador que los fallos de las peticiones. */
  reportError(error: unknown, requestId: string): void;
  /**
   * Espera las tareas en segundo plano registradas en la plataforma de la aplicación, como las de
   * los callbacks de Socket, y después cierra las sesiones y los recursos del runtime.
   */
  close(): Promise<void>;
}

/** Renders a page without server middleware or prerendered output; used by prerendering. */
export const renderPage: unique symbol = Symbol.for("meeko.server-app.render-page") as never;

export type InternalServerApp = ServerApp & { readonly [renderPage]: (request: Request) => Promise<Response> };

function markup(value: DocumentMarkup | undefined, context: { readonly request: Request; readonly nonce: string | undefined }): string {
  return typeof value === "function" ? value(context) : value ?? "";
}

function normalizeOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError(`Invalid publicOrigin: ${value}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("publicOrigin must use HTTP or HTTPS");
  return url.origin;
}

function defaultObserver(production: boolean): ServerErrorObserver {
  return (error, requestId) => {
    console.error(`[meeko] request error ${requestId} (${error instanceof Error ? error.name : "UnknownError"})`);
    if (!production) console.error(error);
  };
}

async function createRuntime<Env>(options: ServerAppOptions<Env>, platform: ServerPlatform<Env>): Promise<ServerRuntime<unknown, Env>> {
  const prerendering = options.prerendering === true;
  if (options.runtime === undefined) {
    if (options.production && !prerendering) {
      throw new Error("Production requires server/runtime.ts with a persistent SessionStore; export defineServerRuntime(...) from it");
    }
    return { sessions: new SessionManager({ store: new MemorySessionStore(), production: false }) };
  }
  if (typeof options.runtime !== "function") throw new TypeError("server/runtime.ts must default-export defineServerRuntime(...)");
  const runtime = await options.runtime({ env: platform.env, production: options.production, platform: platform.name, prerendering });
  const sessions = (runtime as Partial<ServerRuntime> | undefined)?.sessions as Partial<SessionManager> | undefined;
  if (!sessions || typeof sessions.load !== "function" || typeof sessions.assertMutationAllowed !== "function") {
    throw new TypeError("server/runtime.ts must return { sessions: SessionManager }");
  }
  return runtime;
}

async function loadDefault<T>(load: AppModuleLoader, key: string, label: string): Promise<T> {
  const module = await load(key) as { default?: unknown } | undefined;
  if (typeof module?.default !== "function") throw new Error(`${key}: ${label} requires a default function export`);
  return module.default as T;
}

/**
 * Crea la aplicación portable a partir del manifiesto fijado en el build y un cargador de módulos.
 * Llama una vez a la fábrica de `server/runtime.ts`. La entrada que genera `meeko build` la usa; un
 * host propio la sirve con un adaptador como `serveNode`.
 *
 * @param options Manifiesto, cargador, runtime y plataforma.
 * @returns La aplicación.
 * @throws {TypeError} Si el manifiesto es de otra versión, falta el cargador o el runtime no devuelve `sessions`.
 * @throws {Error} En producción sin `server/runtime.ts`.
 * @example
 * ```ts
 * import { createServerApp } from "@meekojs/meeko/server";
 * import { serveNode } from "@meekojs/meeko/node";
 * import { load, manifest, runtime } from "virtual:meeko-server-app";
 *
 * const app = await createServerApp({ manifest, load, runtime, production: true });
 * const server = await serveNode(app, { port: 3000, handleSignals: true });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#runtime-de-servidor
 */
export async function createServerApp<Env = Readonly<Record<string, string | undefined>>>(options: ServerAppOptions<Env>): Promise<ServerApp> {
  const manifest = options.manifest;
  if (!manifest || manifest.version !== 1) throw new TypeError("Unsupported Meeko application manifest; rebuild the application");
  if (typeof options.load !== "function") throw new TypeError("createServerApp requires a module loader");
  const load = options.load;
  const hostPlatform: ServerPlatform<Env> = options.platform ?? createDetachedPlatform({} as Env);
  // Background work started outside a request, such as in Socket callbacks,
  // is tracked so close() waits for it and failures reach the error observer.
  const background = new Set<Promise<unknown>>();
  let reportBackground: (error: unknown) => void = (error) => observeServerError(error, crypto.randomUUID(), defaultObserver(options.production));
  const basePlatform: ServerPlatform<Env> = {
    name: hostPlatform.name,
    env: hostPlatform.env,
    waitUntil(promise) {
      const tracked: Promise<unknown> = Promise.resolve(promise)
        .catch((error: unknown) => reportBackground(error))
        .finally(() => background.delete(tracked));
      background.add(tracked);
      hostPlatform.waitUntil(tracked);
    },
  };
  const runtime = await createRuntime(options, basePlatform);
  const sessions = runtime.sessions;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      while (background.size) await Promise.allSettled([...background]);
      try { await sessions.close(); }
      catch (error) { failures.push(error); }
      try { await runtime.close?.(); }
      catch (error) { failures.push(error); }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Meeko runtime cleanup failed");
    })();
    return closing;
  };
  try {
    const configuredOrigin = options.publicOrigin ?? runtime.publicOrigin;
    const publicOrigin = configuredOrigin ? normalizeOrigin(configuredOrigin) : undefined;
    const reportError: ServerErrorObserver = runtime.onError ?? defaultObserver(options.production);
    reportBackground = (error) => observeServerError(error, crypto.randomUUID(), reportError);
    const platformStore = new AsyncLocalStorage<ServerPlatform>();
    const currentPlatform = (): ServerPlatform => platformStore.getStore() ?? basePlatform;
    const servicesFor = async (request: Request, platform: ServerPlatform): Promise<unknown> => {
      const services = runtime.services;
      return typeof services === "function"
        ? await (services as (request: Request, context: { platform: ServerPlatform }) => unknown)(request, { platform })
        : services ?? {};
    };
    const createContext = async (request: Request): Promise<RequestContext> => {
      const platform = currentPlatform();
      const session = await sessions.load(request);
      return createRequestContext(request, await servicesFor(request, platform), session, platform);
    };
    const dispatch = createContextDispatcher({ manifest: manifest.server, sessions, load, onError: reportError });
    const endpoints = async (request: Request): Promise<Response> => {
      let requestId: string = crypto.randomUUID();
      try {
        const context = await createContext(request);
        requestId = context.requestId;
        return await dispatch(context);
      } catch (error) { reportServerError(error, requestId, reportError); return errorResponse(error, requestId); }
    };
    const clientHead = [
      ...manifest.client.css.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
      ...manifest.client.preload.map((href) => `<link rel="modulepreload" href="${escapeHtml(href)}">`),
    ].join("");
    const document: DocumentOptions = {
      head: (context) => clientHead + markup(options.document?.head, context),
      ...(options.document?.bodyEnd === undefined ? {} : { bodyEnd: options.document.bodyEnd }),
      ...(options.document?.nonce === undefined ? {} : { nonce: options.document.nonce }),
    };
    const pageOptions: PageHandlerOptions = {
      routes: manifest.routes,
      ...(manifest.errorPage ? { errorPage: manifest.errorPage } : {}),
      loadPage: async (key) => {
        const module = await load(key) as PageModule | undefined;
        if (!module || typeof module.renderWithState !== "function") throw new Error(`Invalid page module: ${key}`);
        return module;
      },
      loadRoute: async (key) => {
        const module = await load(key) as Record<string, unknown> | undefined;
        if (!module || typeof module !== "object") throw new Error(`Invalid route module: ${key}`);
        return (module.route ?? module.default ?? module) as PageRoute;
      },
      loadMiddleware: () => Promise.all(manifest.routeMiddleware.map((key) => loadDefault<RouteMiddleware>(load, key, "route middleware"))),
      createContext,
      serverFetch: createLocalServerFetch({ manifest: manifest.server, sessions, load, onError: reportError }),
      onError: reportError,
      clientEntry: manifest.client.entry,
      document,
    };
    const pages = createPageHandler(options.prerender ? { ...pageOptions, prerendered: options.prerender } : pageOptions);
    const renderOnly = createPageHandler(pageOptions);
    const serverMiddleware: ServerMiddleware[] = manifest.serverMiddleware.map((key) => async (request, next) =>
      (await loadDefault<ServerMiddleware>(load, key, "server middleware"))(request, next));
    const decorated = composeServerMiddleware(serverMiddleware, async (request) => {
      const pathname = new URL(request.url).pathname;
      if (pathname.startsWith("/api/") || pathname.startsWith("/_meeko/rpc/")) return endpoints(request);
      return pages(request);
    });
    const withPublicOrigin = (request: Request): Request => {
      if (!publicOrigin) return request;
      const url = new URL(request.url);
      if (url.origin === publicOrigin) return request;
      // Assigned fields keep a `//host/...` pathname on the public origin.
      const target = new URL(publicOrigin);
      target.pathname = url.pathname;
      target.search = url.search;
      return new Request(target, request);
    };
    let socket: ServerAppSocket | undefined;
    if (manifest.server.socket?.length) {
      const channels = await loadSocketChannels(manifest.server, load);
      const pubsub = runtime.socket?.pubsub ?? options.defaultSocketPubSub;
      const hub = createSocketHub({
        channels, sessions, platform: basePlatform,
        services: (request: Request) => servicesFor(request, currentPlatform()),
        ...(runtime.socket?.allowedOrigins ? { allowedOrigins: runtime.socket.allowedOrigins } : {}),
        ...(runtime.socket?.maxMessageBytes === undefined ? {} : { maxMessageBytes: runtime.socket.maxMessageBytes }),
        ...(runtime.socket?.maxBufferBytes === undefined ? {} : { maxBufferBytes: runtime.socket.maxBufferBytes }),
        ...(runtime.socket?.maxPendingDeliveries === undefined ? {} : { maxPendingDeliveries: runtime.socket.maxPendingDeliveries }),
        ...(runtime.socket?.sessionRefreshMs === undefined ? {} : { sessionRefreshMs: runtime.socket.sessionRefreshMs }),
        ...(pubsub ? { pubsub } : {}),
        // Delivery failures belong to this instance, never to the broadcaster.
        onDeliveryError: runtime.socket?.onDeliveryError ?? ((error) => observeServerError(error, crypto.randomUUID(), reportError)),
      });
      socket = {
        hub, pathnamePrefix: "/_meeko/socket",
        ...(runtime.socket?.maxMessageBytes === undefined ? {} : { maxMessageBytes: runtime.socket.maxMessageBytes }),
        ...(pubsub ? { pubsub } : {}),
        ...(typeof sessions.cookieName === "string" ? { sessionCookieName: sessions.cookieName } : {}),
      };
    }
    // href(id) in API, RPC and server middleware uses this application's manifest.
    const run = (platform: ServerPlatform, handler: () => Promise<Response>): Promise<Response> =>
      platformStore.run(platform, () => withRouteManifest(manifest.routes, async () => {
        try { return await handler(); }
        catch (error) {
          const requestId = crypto.randomUUID();
          observeServerError(error, requestId, reportError);
          return errorResponse(error, requestId);
        }
      }));
    const app: InternalServerApp = {
      fetch(request, platform = basePlatform) {
        return run(platform, async () => {
          const normalized = withPublicOrigin(request);
          if (options.assets) {
            const asset = await options.assets.get(new URL(normalized.url).pathname, normalized);
            if (asset) return asset;
          }
          return decorated(normalized);
        });
      },
      [renderPage]: (request) => run(basePlatform, () => renderOnly(withPublicOrigin(request))),
      manifest,
      ...(socket ? { socket } : {}),
      ...(publicOrigin ? { publicOrigin } : {}),
      reportError: (error, requestId) => observeServerError(error, requestId, reportError),
      close,
    };
    return app;
  } catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], "Meeko application startup and cleanup failed"); }
    throw error;
  }
}
