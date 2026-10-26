/**
 * Destino de ejecución de `meeko build`, una unión discriminada por `adapter`. Cada adaptador
 * escribe en `.meeko/output/<adapter>/`; `--adapter` de la CLI tiene prioridad.
 *
 * @example
 * ```ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   server: { adapter: "cloudflare", name: "mi-app", wrangler: { vars: { PUBLIC_ORIGIN: "https://mi-app.example" } } },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#build-despliegue-y-verificación
 */
export type MeekoServerConfig =
  | {
    readonly adapter: "node";
    /** Interfaz en la que escucha `meeko start`. Por defecto, `127.0.0.1`; `HOST` la sustituye. */
    readonly host?: string;
    /** Puerto de `meeko start`. Por defecto, `4173`; `PORT` lo sustituye. */
    readonly port?: number;
  }
  | {
    readonly adapter: "cloudflare";
    /** Nombre del Worker en el `wrangler.jsonc` generado. Por defecto, el nombre del paquete. */
    readonly name?: string;
    /** Clase Durable Object exportada para las salas de Socket. Por defecto, `MeekoSocketRoom`. */
    readonly socketClassName?: string;
    /** Fecha de compatibilidad de Workers (`YYYY-MM-DD`). Por defecto, la fecha con la que se prueba Meeko. */
    readonly compatibilityDate?: string;
    /**
     * Campos adicionales de `wrangler.jsonc`, como `d1_databases`, `vars` o `routes`.
     * `compatibility_flags` y `durable_objects.bindings` se combinan con los de Meeko. La clase de
     * salas recibe la migración de Meeko sólo si no hay `migrations`; un historial existente debe
     * crearla él mismo, y un mapa `exports` recibe su entrada. `main`, `assets`, `no_bundle` y
     * `find_additional_modules` pertenecen a Meeko.
     */
    readonly wrangler?: Readonly<Record<string, unknown>>;
  }
  | { readonly adapter: "deno" }
  | { readonly adapter: "bun" };

/**
 * Nombre de un adaptador de build: `"node"`, `"cloudflare"`, `"deno"` o `"bun"`.
 *
 * @example
 * ```ts
 * import type { MeekoAdapterName } from "@meekojs/meeko/build";
 *
 * const adapter: MeekoAdapterName = process.env.MEEKO_ADAPTER === "bun" ? "bun" : "node";
 * ```
 */
export type MeekoAdapterName = MeekoServerConfig["adapter"];

/**
 * Configuración de proyecto de `meeko.config.ts`. Créela con {@link defineMeekoConfig}.
 *
 * @example
 * ```ts
 * import type { MeekoConfig } from "@meekojs/meeko/framework";
 *
 * const config: MeekoConfig = {
 *   extends: ["./layers/base"],
 *   modules: ["./modules/auth"],
 *   imports: { serverDirs: ["server/services"] },
 *   server: { adapter: "node", port: 3000 },
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#configuración-módulos-y-layers
 */
export interface MeekoConfig {
  /** Layers, aplicados después de la aplicación en el orden escrito. Las colisiones de URL fallan. */
  readonly extends?: readonly string[];
  /** Módulos, con la misma convención `app/pages` que los layers; van después de ellos. */
  readonly modules?: readonly string[];
  /** `serverDirs` añade directorios de autoimports exclusivos del servidor. */
  readonly imports?: { readonly serverDirs?: readonly string[] };
  /** Destino del servidor de producción. Por defecto, `{ adapter: "node" }`. */
  readonly server?: MeekoServerConfig;
}

/**
 * Declara la configuración de `meeko.config.ts` con sus tipos. En tiempo de ejecución devuelve el
 * mismo objeto; conserva los literales (`const T`) para que `server.adapter` siga discriminado.
 *
 * @param config Configuración del proyecto.
 * @returns La misma configuración.
 * @example
 * ```ts
 * // meeko.config.ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   extends: ["./layers/base"],
 *   modules: ["./modules/auth"],
 *   imports: { serverDirs: ["server/services", "server/repositories"] },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#configuración-módulos-y-layers
 */
export function defineMeekoConfig<const T extends MeekoConfig>(config: T): T {
  return config;
}
