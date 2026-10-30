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

