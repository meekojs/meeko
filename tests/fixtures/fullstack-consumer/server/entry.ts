import { createFrameworkHandler, createLocalServerFetch, createRequestContext, createServerDispatcher, createSocketHub, discoverServerManifest, loadSocketChannels, type FrameworkHandlerOptions } from "@meekojs/meeko/server";
import type { RouteRecord } from "@meekojs/meeko/framework";
import { modules as pages } from "virtual:meeko-server-pages";
import { modules as routeModules } from "virtual:meeko-server-routes";
import { createSessionManager } from "./session.js";

const handlers = import.meta.glob(["/server/api/**/*.ts", "/server/rpc/**/*.ts", "/server/socket/**/*.ts"], { eager: true });

function keyFor(root: string, file: string): string {
  return "/" + file.slice(root.length).replaceAll("\\", "/").replace(/^\//, "");
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

export async function createAppRuntime(root: string, routes: readonly RouteRecord[], clientEntry: string, production: boolean) {
  const sessions = createSessionManager(production);
  const manifest = await discoverServerManifest(root);
  const load = async (file: string) => {
    const module = handlers[keyFor(root, file)];
    if (!module) throw new Error("Server handler missing: " + file);
    return module;
  };
  const services = {};
  const pageHandler = createFrameworkHandler({
    routes,
    loadPage: (file) => loadPage(root, file),
    loadRoute: (file) => loadRoute(root, file),
    clientEntry,
    createContext: async (request) => createRequestContext(request, services, await sessions.load(request)),
    serverFetch: createLocalServerFetch({ manifest, sessions, load }),
  });
  const endpointHandler = createServerDispatcher({ manifest, sessions, services, load });
  const channels = await loadSocketChannels(manifest, load);
  const socketHub = createSocketHub({ channels, sessions, services });
  return { pageHandler, endpointHandler, socketHub, sessions, manifest };
}
