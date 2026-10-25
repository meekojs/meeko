import { AsyncLocalStorage } from "node:async_hooks";
import type { RouteMiddleware } from "../framework/middleware.js";
import type { RouteRecord } from "../framework/router.js";
import { createPageHandler } from "../framework/server.js";
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
import type { SocketHub } from "./socket.js";

/** Client build files linked from every server-rendered document. */
export interface ClientAssets {
  /** URL of the client entry module. */
  readonly entry: string;
  readonly css: readonly string[];
  /** Static imports of the entry, announced with `modulepreload`. */
  readonly preload: readonly string[];
}

/**
 * Everything the server needs to route requests, baked at build time. Files
 * are project-relative module keys such as `/app/pages/index.meeko`.
 */
export interface AppManifest {
  readonly version: 1;
  readonly routes: readonly RouteRecord[];
  readonly server: ServerManifest;
  readonly routeMiddleware: readonly string[];
  readonly serverMiddleware: readonly string[];
  readonly client: ClientAssets;
  /** Public build files; development hosts serve files through Vite instead. */
  readonly assets?: AssetManifest;
}

/** Resolves a manifest key to its module. */
export type AppModuleLoader = (key: string) => Promise<unknown>;

export interface ServerAppOptions<Env = Readonly<Record<string, string | undefined>>> {
  readonly manifest: AppManifest;
  readonly load: AppModuleLoader;
  /** Default export of `server/runtime.ts`; without it only development memory sessions exist. */
  readonly runtime?: ServerRuntimeDefinition<Env, any> | undefined;
  readonly production: boolean;
  /** Platform passed to the runtime factory and used when `fetch` receives none. */
  readonly platform?: ServerPlatform<Env>;
  readonly assets?: AssetReader;
  /** Prerendered pages; listed URLs skip the loader and renderer. */
  readonly prerender?: PrerenderSource;
  /** Host additions to every HTML document. */
  readonly document?: DocumentOptions;
  /** Overrides `ServerRuntime.publicOrigin`. */
  readonly publicOrigin?: string;
  /** Set by `meeko build` while it renders prerendered pages. */
  readonly prerendering?: boolean;
}

export interface ServerAppSocket {
  readonly hub: SocketHub;
  readonly pathnamePrefix: string;
  readonly maxMessageBytes?: number;
}

/** A portable application: adapters translate their requests to `fetch`. */
export interface ServerApp {
  fetch(request: Request, platform?: ServerPlatform): Promise<Response>;
  /** Present when the application declares Socket channels. */
  readonly socket?: ServerAppSocket;
  readonly manifest: AppManifest;
  readonly publicOrigin?: string;
  /** Sends a transport failure to the same observer as request failures. */
  reportError(error: unknown, requestId: string): void;
  /**
   * Waits for background tasks registered on the application's platform, such
   * as those of Socket callbacks, then closes the runtime's sessions and resources.
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

/** Creates the portable application from a baked manifest and a module loader. */
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
      const hub = createSocketHub({
        channels, sessions, platform: basePlatform,
        services: (request: Request) => servicesFor(request, currentPlatform()),
        ...(runtime.socket?.allowedOrigins ? { allowedOrigins: runtime.socket.allowedOrigins } : {}),
        ...(runtime.socket?.maxMessageBytes === undefined ? {} : { maxMessageBytes: runtime.socket.maxMessageBytes }),
        ...(runtime.socket?.maxBufferBytes === undefined ? {} : { maxBufferBytes: runtime.socket.maxBufferBytes }),
        ...(runtime.socket?.pubsub ? { pubsub: runtime.socket.pubsub } : {}),
      });
      socket = {
        hub, pathnamePrefix: "/_meeko/socket",
        ...(runtime.socket?.maxMessageBytes === undefined ? {} : { maxMessageBytes: runtime.socket.maxMessageBytes }),
      };
    }
    const run = (platform: ServerPlatform, handler: () => Promise<Response>): Promise<Response> =>
      platformStore.run(platform, async () => {
        try { return await handler(); }
        catch (error) {
          const requestId = crypto.randomUUID();
          observeServerError(error, requestId, reportError);
          return errorResponse(error, requestId);
        }
      });
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
