import type { ContentSecurityPolicy } from "../framework-server/csp.js";
import type { DocumentConfig } from "./head.js";
import type { MeekoModuleEntry } from "./module.js";

/**
 * Archivo de cabeceras que escribe el adaptador `static` en su salida: `"_headers"` es el formato
 * de Netlify y Cloudflare Pages (`/_headers`); `"nginx"`, un archivo de directivas `add_header`
 * en `/_meeko/headers.conf` para incluir con `include` en cada `location`.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { StaticHeaderFile } from "@meekojs/meeko/framework";
 *
 * const files: StaticHeaderFile[] = process.env.NETLIFY ? ["_headers"] : ["nginx"];
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sitio-estático
 */
export type StaticHeaderFile = "_headers" | "nginx";

/**
 * Destino de ejecución de `meeko build`, una unión discriminada por `adapter`. Cada adaptador
 * escribe en `.meeko/output/<adapter>/`; `--adapter` de la CLI tiene prioridad.
 *
 * @example
 * ```ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   server: { adapter: "cloudflare", name: "mi-app", wrangler: { vars: { MEEKO_PUBLIC_ORIGIN: "https://mi-app.example" } } },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#build-despliegue-y-verificación
 */
export type MeekoServerConfig =
  | {
    /** Servidor Node en `.meeko/output/node/`, el que sirve `meeko start`. */
    readonly adapter: "node";
    /** Interfaz en la que escucha `meeko start`. Por defecto, `127.0.0.1`; `HOST` la sustituye. */
    readonly host?: string;
    /** Puerto de `meeko start`. Por defecto, `4173`; `PORT` lo sustituye. */
    readonly port?: number;
  }
  | {
    /** Worker de Cloudflare con su `wrangler.jsonc`, en `.meeko/output/cloudflare/`. */
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
  | {
    /** Servidor Deno en `.meeko/output/deno/`. */
    readonly adapter: "deno";
  }
  | {
    /** Servidor Bun en `.meeko/output/bun/`. */
    readonly adapter: "bun";
  }
  | {
    /**
     * Sitio estático en `.meeko/output/static/`, sin servidor: los assets, `public/`, cada página
     * prerenderizada como `<ruta>/index.html` con su payload `<ruta>/index.meeko.json` y
     * `404.html` de `app/error.meeko`. Todas las páginas deben usar `render: "prerender"`, y la
     * aplicación no puede tener API, RPC, Socket ni middleware de servidor.
     * @since 1.3.0
     */
    readonly adapter: "static";
    /**
     * Política `Content-Security-Policy` de todas las páginas, por directiva. El build añade a
     * `script-src` el hash SHA-256 de cada `<script>` en línea que ejecutan las páginas, y falla si
     * una página tiene JavaScript que un hash no puede permitir (atributos `on*` o URL
     * `javascript:`). Se escribe en `headerFiles`.
     * @since 1.3.0
     */
    readonly contentSecurityPolicy?: ContentSecurityPolicy;
    /**
     * Otras cabeceras de todas las respuestas, como `Referrer-Policy` o `Permissions-Policy`. Se
     * escriben en `headerFiles` después de la CSP.
     * @since 1.3.0
     */
    readonly headers?: Readonly<Record<string, string>>;
    /**
     * Archivos de cabeceras para el hosting: `"_headers"` (Netlify, Cloudflare Pages) y `"nginx"`
     * (`_meeko/headers.conf`). Por defecto, ninguno: el hosting configura sus cabeceras.
     * @since 1.3.0
     */
    readonly headerFiles?: readonly StaticHeaderFile[];
  };

/**
 * Nombre de un adaptador de build: `"node"`, `"cloudflare"`, `"deno"`, `"bun"` o, desde `1.3`,
 * `"static"`.
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
 * Opciones de `sitemap` en `meeko.config.ts`.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { SitemapConfig } from "@meekojs/meeko/framework";
 *
 * const sitemap: SitemapConfig = { exclude: ["/admin", "/admin/*", "/borradores/*"] };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sitemapxml-y-robotstxt
 */
export interface SitemapConfig {
  /**
   * Rutas (`pathname`) que no se listan. `*` sustituye a cualquier secuencia de caracteres, `/`
   * incluida: `"/admin/*"` excluye todo lo que hay bajo `/admin/`, pero no `/admin`.
   */
  readonly exclude?: readonly string[];
}

/**
 * Opciones de `robots` en `meeko.config.ts`: las reglas para `User-agent: *`.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { RobotsConfig } from "@meekojs/meeko/framework";
 *
 * const robots: RobotsConfig = { disallow: ["/admin/"] };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sitemapxml-y-robotstxt
 */
export interface RobotsConfig {
  /** Prefijos permitidos (`Allow:`). Por defecto, `["/"]` si no hay `disallow`. */
  readonly allow?: readonly string[];
  /** Prefijos prohibidos (`Disallow:`). */
  readonly disallow?: readonly string[];
}

/**
 * Configuración de proyecto de `meeko.config.ts`. Créela con {@link defineMeekoConfig}.
 *
 * @example
 * ```ts
 * import type { MeekoConfig } from "@meekojs/meeko/framework";
 *
 * const config: MeekoConfig = {
 *   layers: ["./layers/base"],
 *   modules: ["@acme/seo", ["./modules/hello", { greeting: "Hola" }]],
 *   imports: { serverDirs: ["server/services"] },
 *   server: { adapter: "node", port: 3000 },
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#layers
 */
export interface MeekoConfig {
  /**
   * Layers: carpetas del proyecto con su propio `app/pages`, componentes, autoimports y
   * `app/plugins`, aplicadas después de la aplicación en el orden escrito. Las colisiones de URL
   * fallan.
   * @since 1.2.0
   */
  readonly layers?: readonly string[];
  /** Alias de `layers` que se mantiene: sus carpetas van antes que las de `layers`. */
  readonly extends?: readonly string[];
  /**
   * Módulos creados con `defineMeekoModule`: un módulo importado, un nombre de paquete, una ruta a
   * un módulo o `[módulo, opciones]`, aplicados en orden. Hasta `1.1` eran carpetas con
   * `app/pages`; esas carpetas siguen funcionando como layers en `1.x`, con un aviso (use `layers`).
   */
  readonly modules?: readonly MeekoModuleEntry[];
  /**
   * Carpetas de autoimports además de las de por defecto, relativas a la raíz del proyecto y de
   * cada layer. Cada carpeta toma el ámbito de la carpeta que la contiene, como las de por defecto.
   */
  readonly imports?: {
    /**
     * Carpetas dentro de `app/` cuyos exports se autoimportan con el ámbito de `app/`: en el
     * navegador y en SSR (componentes, páginas y `.ts` de `app/`), no en `shared/` ni en `server/`.
     * Sólo exports: los `.meeko` de estas carpetas no se registran como componentes.
     * @since 1.3.0
     * @example
     * ```ts
     * imports: { appDirs: ["app/services", "app/features/cart"] }
     * ```
     */
    readonly appDirs?: readonly string[];
    /**
     * Carpetas dentro de `shared/` cuyos exports se autoimportan con el ámbito de `shared/`: en
     * `app/`, en `server/` y en el propio `shared/`.
     * @since 1.3.0
     * @example
     * ```ts
     * imports: { sharedDirs: ["shared/validators"] }
     * ```
     */
    readonly sharedDirs?: readonly string[];
    /** Carpetas dentro de `server/` cuyos exports se autoimportan sólo en el código de servidor. */
    readonly serverDirs?: readonly string[];
  };
  /** Destino del servidor de producción. Por defecto, `{ adapter: "node" }`. */
  readonly server?: MeekoServerConfig;
  /**
   * Estilos de los componentes. `scopeAttribute` elige qué elementos reciben el atributo de
   * `<style scoped>`: `"all"` (por defecto en 1.x), todos los de la plantilla; `"matched"`
   * (desde `1.2`), sólo los que algún selector con ámbito puede seleccionar. Con `"matched"`, una
   * clase o un atributo que el script añade con la API del DOM a un elemento sin `ref:` ni `on:`
   * no recibe los estilos con ámbito si ese elemento quedó sin atributo. En `2.0`, `"matched"`
   * pasará a ser el valor por defecto.
   */
  readonly css?: { readonly scopeAttribute?: "all" | "matched" };
  /**
   * Documento HTML de la aplicación: `lang` de `<html>` y etiquetas y atributos comunes de
   * `<head>`, con la menor prioridad frente a `useHead` y al `head` de las páginas. Los módulos
   * añaden sus entradas con `meeko.addHead`; las de este campo se aplican después. Se fija en el
   * build y llega también al navegador, porque termina en el HTML.
   * @since 1.2.0
   */
  readonly document?: DocumentConfig;
  /**
   * Opciones de `meeko dev`; no afectan a `meeko build` ni a `meeko start`. `serverLogs: false`
   * deja de reenviar a la consola del navegador lo que el código de servidor escribe con
   * `console.log`, `info`, `warn`, `error` o `debug` mientras atiende una petición (activado por
   * defecto). La terminal lo muestra igual en ambos casos.
   * @since 1.3.0
   * @example
   * ```ts
   * import { defineMeekoConfig } from "@meekojs/meeko/framework";
   *
   * export default defineMeekoConfig({ dev: { serverLogs: false } });
   * ```
   */
  readonly dev?: {
    /** Reenvía los logs del servidor a la consola del navegador en `meeko dev`. Por defecto, `true`. */
    readonly serverLogs?: boolean;
  };
  /**
   * URL pública del sitio, de la que sólo cuenta el origen (`https://example.com`, sin ruta). La
   * usan `sitemap.xml`, `robots.txt` y, con `document.seo`, `<link rel="canonical">` y `og:url`.
   * Sin ella se usa `MEEKO_PUBLIC_ORIGIN` del entorno del build. Se fija en el build; no cambia
   * las comprobaciones de `Origin`, que siguen leyendo `MEEKO_PUBLIC_ORIGIN` o `publicOrigin` de
   * `server/runtime.ts` al ejecutarse.
   * @since 1.3.0
   */
  readonly site?: string;
  /**
   * Escribe `sitemap.xml` con las páginas prerenderizadas y las rutas sin parámetros, salvo las
   * excluidas y las prerenderizadas con `<meta name="robots">` `noindex`. Necesita `site` o
   * `MEEKO_PUBLIC_ORIGIN`.
   * @since 1.3.0
   */
  readonly sitemap?: boolean | SitemapConfig;
  /**
   * Escribe `robots.txt` con las reglas de `User-agent: *` y, con `sitemap`, su URL absoluta. No
   * puede convivir con un `public/robots.txt`.
   * @since 1.3.0
   */
  readonly robots?: boolean | RobotsConfig;
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
 *   layers: ["./layers/base"],
 *   modules: ["@acme/seo"],
 *   imports: {
 *     appDirs: ["app/services"],
 *     sharedDirs: ["shared/validators"],
 *     serverDirs: ["server/services", "server/repositories"],
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#layers
 */
export function defineMeekoConfig<const T extends MeekoConfig>(config: T): T {
  return config;
}
