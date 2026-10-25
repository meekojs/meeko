/** Vite entry modules generated for a framework application. */
export const clientEntrySource = `import { mountClientApp, type ClientComponent, type RouteRecord, type RouteMiddleware } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-client-pages";

const middlewareModules = import.meta.glob(["/app/middleware/**/*.ts", "!/app/middleware/**/*.test.ts", "!/app/middleware/**/*.spec.ts", "!/app/middleware/**/*.d.ts", "!/app/middleware/**/*.server.ts", "!/app/middleware/**/*.client.ts"], { eager: true });
const loadMiddleware = async (): Promise<RouteMiddleware[]> => Object.entries(middlewareModules)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([file, module]) => {
    const middleware = (module as { default?: unknown }).default;
    if (typeof middleware !== "function") throw new Error(file + ": route middleware requires a default function export");
    return middleware as RouteMiddleware;
  });

// Optional global stylesheet. Vite includes it in the client bundle when present.
import.meta.glob("/app/styles/main.css", { eager: true });

const root = document.getElementById("app");
const payload = document.getElementById("meeko-payload")?.textContent;
const routesText = document.getElementById("meeko-routes")?.textContent;
if (!root || !payload || !routesText) throw new Error("Missing Meeko SSR data");
const routes = JSON.parse(routesText) as RouteRecord[];

const hydrationStart = performance.now();
await mountClientApp({
  root, payload, routes, serverData: true, loadMiddleware,
  async loadPage(file) {
    const load = pages[file];
    if (!load) throw new Error("Page module missing: " + file);
    return await load() as ClientComponent;
  },
});
performance.measure("meeko-hydration", { start: hydrationStart, end: performance.now() });
`;

export const serverEntrySource = `import { createFrameworkHandler, createLocalServerFetch, createRequestContext, createServerDispatcher, createSocketHub, discoverServerManifest, loadSocketChannels, type FrameworkHandlerOptions, type ServerMiddleware } from "@meekojs/meeko/server";
import type { RouteRecord, RouteMiddleware } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-server-pages";
import { modules as routeModules } from "virtual:meeko-server-routes";
import { createSessionManager } from "../../server/session.js";

const handlers = import.meta.glob(["/server/api/**/*.ts", "/server/rpc/**/*.ts", "/server/socket/**/*.ts"], { eager: true });
const routeMiddlewareModules = import.meta.glob(["/app/middleware/**/*.ts", "!/app/middleware/**/*.test.ts", "!/app/middleware/**/*.spec.ts", "!/app/middleware/**/*.d.ts", "!/app/middleware/**/*.server.ts", "!/app/middleware/**/*.client.ts"], { eager: true });
const serverMiddlewareModules = import.meta.glob(["/server/middleware/**/*.ts", "!/server/middleware/**/*.test.ts", "!/server/middleware/**/*.spec.ts", "!/server/middleware/**/*.d.ts", "!/server/middleware/**/*.client.ts"], { eager: true });

function keyFor(root: string, file: string): string {
  return "/" + file.slice(root.length).replaceAll("\\\\", "/").replace(/^\\//, "");
}

export const loadPage = async (root: string, file: string): Promise<Awaited<ReturnType<FrameworkHandlerOptions["loadPage"]>>> => {
  const key = keyFor(root, file);
  const module = pages[key];
  if (!module) throw new Error("Page module missing: " + key);
  return module as Awaited<ReturnType<FrameworkHandlerOptions["loadPage"]>>;
};

export const loadRoute = async (root: string, file: string): Promise<Awaited<ReturnType<NonNullable<FrameworkHandlerOptions["loadRoute"]>>>> => {
  const key = keyFor(root, file);
  const module = routeModules[key] as Record<string, unknown> | undefined;
  if (!module) throw new Error("Route module missing: " + key);
  return (module.route ?? module.default ?? module) as Awaited<ReturnType<NonNullable<FrameworkHandlerOptions["loadRoute"]>>>;
};

export async function createAppRuntime(
  root: string,
  routes: readonly RouteRecord[],
  clientEntry: string,
  production: boolean,
  loadDevModule?: (file: string) => Promise<Record<string, unknown>>,
) {
  const sessions = createSessionManager(production);
  const manifest = await discoverServerManifest(root);
  const load = async (file: string) => {
    if (loadDevModule) return loadDevModule(file);
    const module = handlers[keyFor(root, file)];
    if (!module) throw new Error("Server handler missing: " + file);
    return module;
  };
  const services = {};
  const loadMiddleware = async (): Promise<RouteMiddleware[]> => Promise.all(Object.keys(routeMiddlewareModules).sort().map(async (key) => {
    const module = loadDevModule ? await loadDevModule(root + key) : routeMiddlewareModules[key] as Record<string, unknown>;
    const middleware = (module as { default?: unknown }).default;
    if (typeof middleware !== "function") throw new Error(key + ": route middleware requires a default function export");
    return middleware as RouteMiddleware;
  }));
  const serverMiddleware: ServerMiddleware[] = Object.keys(serverMiddlewareModules).sort().map((key) => async (request, next) => {
    const module = loadDevModule ? await loadDevModule(root + key) : serverMiddlewareModules[key] as Record<string, unknown>;
    const middleware = (module as { default?: unknown }).default;
    if (typeof middleware !== "function") throw new Error(key + ": server middleware requires a default function export");
    return (middleware as ServerMiddleware)(request, next);
  });
  const reportError = (error: unknown, requestId: string): void => {
    console.error("[meeko] request error " + requestId + " (" + (error instanceof Error ? error.name : "UnknownError") + ")");
    if (!production) console.error(error);
  };
  const pageHandler = createFrameworkHandler({
    routes,
    onError: reportError,
    loadPage: async (file) => {
      if (!loadDevModule) return loadPage(root, file);
      const module = await loadDevModule(file);
      if (typeof module.renderWithState !== "function") throw new Error("Invalid page module: " + file);
      return module as unknown as Awaited<ReturnType<FrameworkHandlerOptions["loadPage"]>>;
    },
    loadRoute: async (file) => {
      if (!loadDevModule) return loadRoute(root, file);
      const module = await loadDevModule(file);
      return (module.route ?? module.default ?? module) as Awaited<ReturnType<NonNullable<FrameworkHandlerOptions["loadRoute"]>>>;
    },
    clientEntry,
    loadMiddleware,
    createContext: async (request) => createRequestContext(request, services, await sessions.load(request)),
    serverFetch: createLocalServerFetch({ manifest, sessions, load, onError: reportError }),
  });
  const endpointHandler = createServerDispatcher({ manifest, sessions, services, load, onError: reportError });
  const channels = await loadSocketChannels(manifest, load);
  const socketHub = createSocketHub({ channels, sessions, services });
  return { pageHandler, endpointHandler, socketHub, sessions, manifest, serverMiddleware };
}
`;
