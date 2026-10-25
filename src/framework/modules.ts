import { resolve } from "node:path";
import { createRouteManifest } from "./router.js";
import type { RouteRecord } from "./router.js";
import { discoverRoutes } from "./routes-discovery.js";

export interface RouteLayer {
  /** Stable identifier used in diagnostics and generated manifests. */
  readonly name: string;
  /** Directory containing the layer's app/pages tree. */
  readonly root: string;
}

export interface RouteModule {
  /** Stable identifier for a module contributing explicit route records. */
  readonly name: string;
  routes(): readonly RouteRecord[] | Promise<readonly RouteRecord[]>;
}

export interface ComposeRoutesOptions {
  readonly projectRoot: string;
  readonly layers?: readonly RouteLayer[];
  readonly modules?: readonly RouteModule[];
}

/**
 * Composes explicit route sources. Every URL collision is an error; no source
 * silently overrides the app, a layer, or another module.
 */
export async function composeFrameworkRoutes(options: ComposeRoutesOptions): Promise<readonly RouteRecord[]> {
  const names = new Set(["app"]);
  const roots = new Set([resolve(options.projectRoot).toLowerCase()]);
  for (const source of [...options.layers ?? [], ...options.modules ?? []]) {
    if (!/^[a-z][a-z0-9-]*$/.test(source.name) || names.has(source.name)) {
      throw new Error(`Invalid or duplicate route source name: ${source.name}`);
    }
    names.add(source.name);
  }
  const routes: RouteRecord[] = [...await discoverRoutes(options.projectRoot)];
  for (const layer of options.layers ?? []) {
    const root = resolve(layer.root);
    if (roots.has(root.toLowerCase())) throw new Error(`Duplicate route root: ${root}`);
    roots.add(root.toLowerCase());
    routes.push(...await discoverRoutes(root));
  }
  for (const module of options.modules ?? []) routes.push(...await module.routes());
  return createRouteManifest(routes);
}
