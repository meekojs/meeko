import type { ContentSecurityPolicy } from "../framework-server/csp.js";
import type { DocumentConfig } from "./head.js";
import type { MeekoModuleEntry } from "./module.js";
import type { ThemeConfig } from "./theme.js";

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
 * Cabeceras de las respuestas de un adaptador con servidor (`server.headers`). Una clave con nombre
 * de cabecera se aplica a todas las respuestas; una clave que empieza por `/` es un patrón de ruta
 * (`pathname`, sin query) cuyas cabeceras se aplican sólo a las URL que coinciden, después de las
 * globales y en el orden escrito. En el patrón, `*` sustituye a cualquier secuencia de caracteres,
 * `/` incluida: `"/docs/*"` coincide con `/docs/api`, pero no con `/docs`. Una cabecera que la
 * respuesta ya trae (de un handler, un middleware o Meeko) no se sustituye.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { ServerHeaders } from "@meekojs/meeko/framework";
 *
 * const headers: ServerHeaders = {
 *   "X-Content-Type-Options": "nosniff",
 *   "Referrer-Policy": "strict-origin-when-cross-origin",
 *   "/admin/*": { "X-Robots-Tag": "noindex" },
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
 */
export type ServerHeaders = Readonly<Record<string, string | Readonly<Record<string, string>>>>;

/**
 * Cabeceras de respuesta de los adaptadores con servidor (`node`, `bun`, `deno` y `cloudflare`).
 * Se fijan en el build y se aplican en producción (`meeko start` y las salidas de cada
 * adaptador), no en `meeko dev`.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { ServerResponseConfig } from "@meekojs/meeko/framework";
 *
 * const response: ServerResponseConfig = {
 *   contentSecurityPolicy: { "default-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'none'"] },
 *   headers: { "X-Content-Type-Options": "nosniff" },
 * };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#csp-y-cabeceras-en-los-adaptadores-con-servidor
 */
export interface ServerResponseConfig {
  /**
   * Política `Content-Security-Policy`, por directiva. Meeko le añade, según la respuesta: los
   * hashes del build en una página prerenderizada; un nonce por petición en una página SSR; los
   * hashes de su HTML en una página SSR con `cache`, y `default-src 'none'; frame-ancestors 'none'`
   * sustituye a la política en el JSON de API, RPC y navegación. Nunca añade un nonce ni un hash a
   * una directiva con `'unsafe-inline'`.
   * @since 1.7.0
   */
  readonly contentSecurityPolicy?: ContentSecurityPolicy;
  /**
   * Otras cabeceras, globales o por patrón de ruta (véase {@link ServerHeaders}).
   * `Content-Security-Policy` no se admite aquí: use `contentSecurityPolicy`.
   * @since 1.7.0
   */
  readonly headers?: ServerHeaders;
}

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
  | ({
    /** Servidor Node en `.meeko/output/node/`, el que sirve `meeko start`. */
    readonly adapter: "node";
    /** Interfaz en la que escucha `meeko start`. Por defecto, `127.0.0.1`; `HOST` la sustituye. */
    readonly host?: string;
    /** Puerto de `meeko start`. Por defecto, `4173`; `PORT` lo sustituye. */
    readonly port?: number;
  } & ServerResponseConfig)
  | ({
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
  } & ServerResponseConfig)
  | ({
    /** Servidor Deno en `.meeko/output/deno/`. */
    readonly adapter: "deno";
  } & ServerResponseConfig)
  | ({
    /** Servidor Bun en `.meeko/output/bun/`. */
    readonly adapter: "bun";
  } & ServerResponseConfig)
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
 * Una URL de una ruta en `sitemap.xml`, que declara `sitemapEntries` en `definePage`: los
 * parámetros de la ruta y, de forma opcional, los campos del protocolo sitemaps.org 0.9.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { SitemapEntry } from "@meekojs/meeko/framework";
 *
 * const entry: SitemapEntry = { params: { slug: "instalacion" }, lastmod: "2026-10-01", changefreq: "monthly", priority: 0.8 };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
 */
export interface SitemapEntry {
  /** Parámetros de la ruta (los segmentos `[slug]`), como en `prerenderEntries`. Una ruta sin parámetros no los necesita. */
  readonly params?: Readonly<Record<string, string>>;
  /** Fecha de la última modificación (`<lastmod>`): un `Date` o un texto W3C Datetime, como `"2026-10-01"`. */
  readonly lastmod?: Date | string;
  /** Frecuencia de cambio orientativa (`<changefreq>`). */
  readonly changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  /** Prioridad relativa dentro del sitio (`<priority>`), de `0` a `1`. */
  readonly priority?: number;
}

/**
 * Lo que recibe la función `sitemapEntries` de `definePage`. Se ejecuta durante
 * `meeko build`, en el servidor de Node que prerenderiza las páginas, sin petición ni sesión.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { SitemapEntriesContext, SitemapEntry } from "@meekojs/meeko/framework";
 *
 * async function entries({ env }: SitemapEntriesContext): Promise<SitemapEntry[]> {
 *   const slugs = env.DOCS_DRAFTS === "1" ? ["borrador"] : [];
 *   return slugs.map((slug) => ({ params: { slug } }));
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
 */
export interface SitemapEntriesContext {
  /** Variables de entorno del proceso de `meeko build` (`process.env`). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Siempre `true`: el runtime de `server/runtime.ts` se creó con `prerendering`, sin tráfico de clientes. */
  readonly prerendering: true;
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
  /**
   * Aliases de ruta propios, o cambios de los de Meeko. Cada clave es un prefijo que termina en `/`
   * y cada valor, una carpeta del proyecto (relativa a su raíz; también la de un layer) o `false`
   * para quitar el alias. Por defecto existen `~/` (la raíz del proyecto), `@/` (`app/`),
   * `#shared/` (`shared/`) y `#server/` (`server/`, sólo en el código de servidor). Un alias propio
   * toma el ámbito de la carpeta a la que apunta, como los autoimports: dentro de `server/`, sólo
   * en el servidor; dentro de `app/`, en `app/` y `server/` pero no en `shared/`; en otro lugar, en
   * todo el proyecto. Se aplica en Vite (`meeko dev`, `meeko build` y todos los adaptadores), en los
   * `tsconfig` generados, en el editor y en los módulos de `@utilities`.
   * @since 1.5.0
   * @example
   * ```ts
   * import { defineMeekoConfig } from "@meekojs/meeko/framework";
   *
   * export default defineMeekoConfig({
   *   alias: { "ui/": "app/components/ui/", "#server/": false },
   * });
   * ```
   * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#aliases-de-ruta
   */
  readonly alias?: Readonly<Record<string, string | false>>;
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
   * `MEEKO_PUBLIC_ORIGIN`. Desde `1.7`, también las URL de `sitemapEntries` de `definePage`, como
   * las de las rutas dinámicas con SSR.
   * @since 1.3.0
   */
  readonly sitemap?: boolean | SitemapConfig;
  /**
   * Escribe `robots.txt` con las reglas de `User-agent: *` y, con `sitemap`, su URL absoluta. No
   * puede convivir con un `public/robots.txt`.
   * @since 1.3.0
   */
  readonly robots?: boolean | RobotsConfig;
  /**
   * Tema claro/oscuro (y temas propios) sin parpadeo: la elección se guarda en una cookie, el
   * servidor escribe el tema en `<html>` desde el primer byte y un script en línea de `<head>` lo
   * aplica antes de pintar cuando el servidor no lo conoce (páginas prerenderizadas, adaptador
   * `static`, modo `"system"` sin client hint). Activa `useTheme()`. `true` usa los valores por
   * defecto; sin `theme`, nada cambia.
   * @since 1.4.0
   * @example
   * ```ts
   * import { defineMeekoConfig } from "@meekojs/meeko/framework";
   *
   * export default defineMeekoConfig({ theme: { themes: ["light", "dark", "sepia"], default: "system" } });
   * ```
   * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#tema-clarooscuro-sin-parpadeo
   */
  readonly theme?: boolean | ThemeConfig;
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
