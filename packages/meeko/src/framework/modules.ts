import { resolve } from "node:path";
import { createRouteManifest } from "./router.js";
import type { RouteRecord } from "./router.js";
import { discoverRoutes } from "./routes-discovery.js";

/**
 * Un layer de rutas: una carpeta con su propio árbol `app/pages`, cuyas páginas se muestran dentro
 * del shell del proyecto.
 *
 * @example
 * ```ts
 * import type { RouteLayer } from "@meekojs/meeko/build";
 *
 * const base: RouteLayer = { name: "base", root: "./layers/base" };
 * ```
 */
export interface RouteLayer {
  /** Identificador estable para diagnósticos y manifiestos: minúsculas, dígitos y guiones. */
  readonly name: string;
  /** Carpeta que contiene el árbol `app/pages` del layer. */
  readonly root: string;
}

/**
 * Un módulo programático que aporta rutas explícitas en lugar de un árbol `app/pages`. Sus rutas
 * declaran sus propios layouts.
 *
 * @example
 * ```ts
 * import type { RouteModule } from "@meekojs/meeko/build";
 *
 * const docs: RouteModule = {
 *   name: "docs",
 *   routes: () => [{ id: "/docs/[...slug]", file: "/srv/docs/Page.meeko", layouts: [] }],
 * };
 * ```
 */
export interface RouteModule {
  /** Identificador estable del módulo: minúsculas, dígitos y guiones. */
  readonly name: string;
  /** Devuelve las rutas del módulo. */
  routes(): readonly RouteRecord[] | Promise<readonly RouteRecord[]>;
}

/**
 * Opciones de {@link composeFrameworkRoutes}.
 *
 * @example
 * ```ts
 * import { composeFrameworkRoutes } from "@meekojs/meeko/build";
 * import type { ComposeRoutesOptions } from "@meekojs/meeko/build";
 *
 * const options: ComposeRoutesOptions = { projectRoot: process.cwd(), layers: [{ name: "base", root: "layers/base" }] };
 * const routes = await composeFrameworkRoutes(options);
 * ```
 */
export interface ComposeRoutesOptions {
  /** Carpeta del proyecto, cuyas páginas van primero y cuyo shell envuelve a los layers. */
  readonly projectRoot: string;
  /** Layers con árbol `app/pages`, en orden. */
  readonly layers?: readonly RouteLayer[];
  /** Módulos programáticos, después de los layers. */
  readonly modules?: readonly RouteModule[];
}

/**
 * Compone las rutas del proyecto, de sus layers y de módulos programáticos en un manifiesto.
 * Cualquier colisión de URL es un error: ninguna fuente sustituye en silencio a la aplicación, a
 * un layer o a otro módulo.
 *
 * @param options Proyecto, layers y módulos.
 * @returns El manifiesto de rutas ordenado.
 * @throws {Error} Si un nombre es inválido o se repite, una carpeta se repite o dos rutas colisionan.
 * @example
 * ```ts
 * import { composeFrameworkRoutes } from "@meekojs/meeko/build";
 *
 * const routes = await composeFrameworkRoutes({
 *   projectRoot: process.cwd(),
 *   layers: [{ name: "base", root: "layers/base" }],
 *   modules: [{ name: "health", routes: () => [{ id: "/health", file: "/srv/health/Page.meeko", layouts: [] }] }],
 * });
 * ```
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
    // Layer pages render inside the project's shell and fall back to its error page.
    routes.push(...await discoverRoutes(root, { shell: options.projectRoot }));
  }
  for (const module of options.modules ?? []) routes.push(...await module.routes());
  return createRouteManifest(routes);
}
