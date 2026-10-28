import { createContext, createRoot, effect, findContext, finishWithCleanup, isDryRender, onCleanup, provide } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";
import { escapeHtml } from "../server.js";
import type { ComponentRelease, DomScope } from "../dom.js";
import { applyColorScheme, applyThemeClass, resolveThemeConfig, themeScript, themeStyle, withThemeAttributes } from "./theme.js";
import type { DocumentTheme, ThemeConfig, ThemeHead } from "./theme.js";

/**
 * Etiqueta `<meta>` de {@link HeadInput}. Se deduplica por `key` o, si falta, por `name`,
 * `property` o `httpEquiv`: gana la entrada de más prioridad.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { HeadMeta } from "@meekojs/meeko/framework";
 *
 * const image: HeadMeta = { property: "og:image", content: "https://example.com/og.png" };
 * ```
 */
export interface HeadMeta {
  /** Atributo `name`, como `description` o `robots`. */
  name?: string;
  /** Atributo `property` de Open Graph, como `og:title`. */
  property?: string;
  /** Atributo `http-equiv`. */
  httpEquiv?: string;
  /**
   * Atributo `media`, como en `theme-color`. Forma parte de la deduplicación: dos `theme-color` con
   * distinto `media` conviven.
   * @since 1.2.0
   */
  media?: string;
  /** Atributo `content`. */
  content: string;
  /** Clave de deduplicación explícita; no se escribe en el HTML. */
  key?: string;
}

/**
 * Etiqueta `<link>` de {@link HeadInput}. Se deduplica por `key` o, si falta, por `rel` y `href`;
 * `rel: "canonical"` y `rel: "icon"` son únicos aunque cambie `href`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { HeadLink } from "@meekojs/meeko/framework";
 *
 * const canonical: HeadLink = { rel: "canonical", href: "https://example.com/docs" };
 * ```
 */
export interface HeadLink {
  /** Atributo `rel`. */
  rel: string;
  /** Atributo `href`. */
  href: string;
  /** Atributo `hreflang`. */
  hreflang?: string;
  /** Atributo `type`. */
  type?: string;
  /** Atributo `media`. */
  media?: string;
  /** Atributo `sizes`. */
  sizes?: string;
  /** Atributo `as` de un `preload`. */
  as?: string;
  /** Atributo `crossorigin`. */
  crossorigin?: "" | "anonymous" | "use-credentials";
  /** Clave de deduplicación explícita; no se escribe en el HTML. */
  key?: string;
}

/**
 * Etiqueta `<script>` de {@link HeadInput}: externa con `src` o en línea con `children`. Se
 * deduplica por `key`, por `src` o por su código.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { HeadScript } from "@meekojs/meeko/framework";
 *
 * const analytics: HeadScript = { src: "https://example.com/analytics.js", defer: true };
 * const theme: HeadScript = { children: "document.documentElement.dataset.theme = localStorage.theme ?? 'light'" };
 * ```
 */
export interface HeadScript {
  /** URL del script externo. */
  src?: string;
  /** Atributo `type`, como `"application/ld+json"`. */
  type?: string;
  /** Atributo `async`. */
  async?: boolean;
  /** Atributo `defer`. */
  defer?: boolean;
  /** Escribe `type="module"` si no hay `type`. */
  module?: boolean;
  /** Inline code; Meeko adds the CSP nonce. */
  children?: string;
  /** Clave de deduplicación explícita; no se escribe en el HTML. */
  key?: string;
}

/**
 * Etiqueta `<style>` de {@link HeadInput}. Se deduplica por `key` o por su contenido. Meeko añade
 * el nonce CSP de la petición.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { HeadStyle } from "@meekojs/meeko/framework";
 *
 * const print: HeadStyle = { children: "nav { display: none }", media: "print" };
 * ```
 */
export interface HeadStyle {
  /** CSS de la etiqueta. */
  children: string;
  /** Atributo `media`. */
  media?: string;
  /** Clave de deduplicación explícita; no se escribe en el HTML. */
  key?: string;
}

/**
 * Lo que una configuración, un layout, una página o un componente aporta al `<head>` del documento
 * y a los atributos de `<html>` y `<body>`. Lo reciben {@link useHead}, `document.head` de
 * `meeko.config.ts` y los módulos de Meeko.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { HeadInput } from "@meekojs/meeko/framework";
 *
 * const head: HeadInput = {
 *   title: "Documentación",
 *   titleTemplate: "%s · Meeko",
 *   meta: [{ name: "description", content: "Guía del framework" }],
 *   link: [{ rel: "canonical", href: "https://meeko.dev/docs" }],
 *   htmlAttrs: { lang: "es" },
 * };
 * ```
 */
export interface HeadInput {
  /**
   * Título del documento; gana el de más prioridad. Si el que gana es una cadena vacía, se
   * muestra el `title` de `document.head`, sin plantilla.
   */
  title?: string;
  /**
   * Plantilla del título: `%s` es el título, o una función que lo recibe. Se aplica al título de
   * layouts, páginas, `useHead` y el `head` de la ruta, nunca al `title` de `document.head`.
   */
  titleTemplate?: string | ((title: string) => string);
  /** Etiquetas `<meta>`. */
  meta?: HeadMeta[];
  /** Etiquetas `<link>`. */
  link?: HeadLink[];
  /** Etiquetas `<script>`. */
  script?: HeadScript[];
  /** Etiquetas `<style>`. */
  style?: HeadStyle[];
  /** Atributos de `<html>`, como `lang`, `dir`, `class` o `data-*`; `undefined` no aporta nada. */
  htmlAttrs?: Record<string, string | undefined>;
  /** Atributos de `<body>`; `undefined` no aporta nada. */
  bodyAttrs?: Record<string, string | undefined>;
}

/**
 * `head` de {@link DocumentConfig} y de `meeko.addHead` en los módulos: lo mismo que
 * {@link HeadInput}, pero `titleTemplate` sólo puede ser una cadena, porque el documento se fija en
 * el build como JSON y llega así al navegador. Su `title` es el título del sitio: lo muestran, tal
 * cual y sin `titleTemplate`, las páginas que no tienen título propio o lo dejan vacío.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { DocumentHead } from "@meekojs/meeko/framework";
 *
 * // «Precios - Mi Sitio» en una página titulada «Precios»; «Mi Sitio» en una sin título.
 * const head: DocumentHead = {
 *   title: "Mi Sitio",
 *   titleTemplate: "%s - Mi Sitio",
 *   htmlAttrs: { lang: "es" },
 * };
 * ```
 */
export interface DocumentHead extends Omit<HeadInput, "titleTemplate"> {
  /**
   * Plantilla del título, con `%s` en el lugar del título. Se aplica al título de layouts,
   * páginas, `useHead` y el `head` de la ruta, no al `title` del documento. Una función no se
   * admite aquí: no se puede fijar en el build.
   */
  titleTemplate?: string;
}

/**
 * Documento de la aplicación: `document` de `meeko.config.ts`. Se renderiza en cada documento HTML
 * (SSR, stream, prerender, páginas de error y `render: "client"`) con la menor prioridad, así que
 * cualquier `useHead` o `head` de página lo sustituye. Se fija en el build, así que
 * `head.titleTemplate` debe ser una cadena (véase {@link DocumentHead}).
 *
 * `head.title` es el título del sitio y no pasa por `head.titleTemplate`: una página sin título
 * propio (o con un título vacío) muestra `head.title` tal cual, y una página con título muestra el
 * suyo con la plantilla. La misma regla se aplica en el servidor y al navegar en el cliente.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * // meeko.config.ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   document: {
 *     lang: "es",
 *     head: {
 *       // «Precios - Mi Sitio» en /precios; «Mi Sitio» en una página sin título.
 *       title: "Mi Sitio",
 *       titleTemplate: "%s - Mi Sitio",
 *       link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
 *     },
 *   },
 * });
 * ```
 */
export interface DocumentConfig {
  /** Atributo `lang` de `<html>`; `head.htmlAttrs.lang` tiene prioridad. */
  lang?: string;
  /**
   * Etiquetas y atributos comunes a todos los documentos. `title` es el título del sitio, sin
   * plantilla; `titleTemplate`, una cadena con `%s`, se aplica a los títulos de las páginas.
   */
  head?: DocumentHead;
  /**
   * Etiquetas de SEO que dependen de cada página: con `true`, `<link rel="canonical">` y `og:url`
   * con el origen de `site` (o `MEEKO_PUBLIC_ORIGIN` del build) y la ruta, y `og:title` y
   * `og:description` con el título y la descripción finales. Una página que declara cualquiera de
   * ellas (con `useSeoMeta`, `useHead` o su `head`) la sustituye. Las páginas de error no reciben
   * `canonical` ni `og:url`.
   * @since 1.3.0
   */
  seo?: boolean | DocumentSeo;
  /**
   * Tema claro/oscuro de la aplicación. El build lo copia de `theme` de `meeko.config.ts`, con
   * todas sus opciones decididas (en `meeko.config.ts` se escribe en `theme`, no aquí); un host
   * propio que pasa `DocumentOptions.config` y `mountClientApp({ document })` lo da aquí.
   * @since 1.4.0
   */
  theme?: ThemeConfig;
}

/**
 * Opciones de `document.seo`: cada etiqueta derivada se puede desactivar. Las que no se nombran
 * quedan activas.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * // meeko.config.ts
 * import { defineMeekoConfig } from "@meekojs/meeko/framework";
 *
 * export default defineMeekoConfig({
 *   site: "https://example.com",
 *   // canonical, og:url y og:title; sin og:description.
 *   document: { seo: { ogDescription: false } },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#canónica-y-open-graph-por-página
 */
export interface DocumentSeo {
  /** `<link rel="canonical">` con el origen y la ruta de la página. */
  canonical?: boolean;
  /** `<meta property="og:url">` con la misma URL. */
  ogUrl?: boolean;
  /** `<meta property="og:title">` con el título final de la página. */
  ogTitle?: boolean;
  /** `<meta property="og:description">` con la `description` de la página. */
  ogDescription?: boolean;
  /**
   * Origen absoluto de las URL (`https://example.com`). Por defecto, `site` de `meeko.config.ts`
   * o `MEEKO_PUBLIC_ORIGIN` del entorno del build; sin ninguno, `meeko build` falla si `canonical`
   * u `ogUrl` están activos. Un host propio que pasa `DocumentOptions.config` debe darlo aquí.
   */
  origin?: string;
}

/** `document.seo` with every field decided; the origin is absent when none is known. */
export interface ResolvedSeo {
  readonly canonical: boolean;
  readonly ogUrl: boolean;
  readonly ogTitle: boolean;
  readonly ogDescription: boolean;
  readonly origin?: string;
}

/** The origin of an absolute HTTP(S) URL whose path is `/`, or a `TypeError` naming `label`. */
export function siteOrigin(value: unknown, label: string): string {
  let url: URL;
  try { url = new URL(String(value)); }
  catch { throw new TypeError(`${label} must be an absolute URL such as "https://example.com"`); }
  if (typeof value !== "string" || (url.protocol !== "http:" && url.protocol !== "https:")) throw new TypeError(`${label} must use http: or https:`);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new TypeError(`${label} must be an origin without path, query, fragment or credentials, such as "https://example.com"`);
  }
  return url.origin;
}

/** `document.seo` with its defaults, or `undefined` when it is off. */
export function resolveSeo(value: unknown, label: string, origin?: string): ResolvedSeo | undefined {
  if (value === undefined || value === false) return undefined;
  if (value !== true && !isRecord(value)) fail(label, "must be true, false or an object");
  const options: Record<string, unknown> = value === true ? {} : value;
  for (const [name, field] of Object.entries(options)) {
    if (name === "origin") continue;
    if (!["canonical", "ogUrl", "ogTitle", "ogDescription"].includes(name)) fail(label, `unknown field ${name}`);
    if (field !== undefined && typeof field !== "boolean") fail(label, `${name} must be a boolean`);
  }
  const resolvedOrigin = options.origin === undefined ? origin : siteOrigin(options.origin, `${label}.origin`);
  return {
    canonical: options.canonical !== false, ogUrl: options.ogUrl !== false,
    ogTitle: options.ogTitle !== false, ogDescription: options.ogDescription !== false,
    ...(resolvedOrigin === undefined ? {} : { origin: resolvedOrigin }),
  };
}

/** The page a document renders, for the tags of `document.seo`; `pathname` is absent on error pages. */
export interface HeadPage {
  readonly seo: ResolvedSeo | undefined;
  readonly pathname: string | undefined;
}

/**
 * Atajo tipado de {@link useSeoMeta}: cada campo produce la etiqueta correcta (`name` o `property`).
 * Los campos `undefined` o `null` no producen nada.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { SeoMetaInput } from "@meekojs/meeko/framework";
 *
 * const seo: SeoMetaInput = {
 *   title: "Precios",
 *   description: "Planes y precios",
 *   ogImage: "https://example.com/og/pricing.png",
 *   twitterCard: "summary_large_image",
 *   canonical: "https://example.com/pricing",
 * };
 * ```
 */
export interface SeoMetaInput {
  /** `<title>`. */
  title?: string | null | undefined;
  /** `<meta name="description">`. */
  description?: string | null | undefined;
  /** `<meta property="og:title">`. */
  ogTitle?: string | null | undefined;
  /** `<meta property="og:description">`. */
  ogDescription?: string | null | undefined;
  /** `<meta property="og:image">`. */
  ogImage?: string | null | undefined;
  /** `<meta property="og:image:alt">`. */
  ogImageAlt?: string | null | undefined;
  /** `<meta property="og:image:width">`. */
  ogImageWidth?: string | number | null | undefined;
  /** `<meta property="og:image:height">`. */
  ogImageHeight?: string | number | null | undefined;
  /** `<meta property="og:url">`. */
  ogUrl?: string | null | undefined;
  /** `<meta property="og:type">`, como `"website"` o `"article"`. */
  ogType?: string | null | undefined;
  /** `<meta property="og:site_name">`. */
  ogSiteName?: string | null | undefined;
  /** `<meta property="og:locale">`, como `"es_ES"`. */
  ogLocale?: string | null | undefined;
  /** `<meta name="twitter:card">`. */
  twitterCard?: "summary" | "summary_large_image" | "app" | "player" | null | undefined;
  /** `<meta name="twitter:site">`. */
  twitterSite?: string | null | undefined;
  /** `<meta name="twitter:creator">`. */
  twitterCreator?: string | null | undefined;
  /** `<meta name="twitter:title">`. */
  twitterTitle?: string | null | undefined;
  /** `<meta name="twitter:description">`. */
  twitterDescription?: string | null | undefined;
  /** `<meta name="twitter:image">`. */
  twitterImage?: string | null | undefined;
  /** `<meta name="twitter:image:alt">`. */
  twitterImageAlt?: string | null | undefined;
  /** `<meta name="robots">`, como `"noindex, nofollow"`. */
  robots?: string | null | undefined;
  /** `<meta name="author">`. */
  author?: string | null | undefined;
  /** `<meta name="keywords">`. */
  keywords?: string | null | undefined;
  /** `<meta name="theme-color">`. */
  themeColor?: string | null | undefined;
  /** `<meta name="color-scheme">`. */
  colorScheme?: string | null | undefined;
  /** `<meta name="application-name">`. */
  applicationName?: string | null | undefined;
  /** `<meta name="referrer">`. */
  referrer?: string | null | undefined;
  /** `<link rel="canonical">`. */
  canonical?: string | null | undefined;
}

/** A head input, or a getter or signal that returns one; reactive in the browser. */
type HeadSource<T> = T | ReadonlySignal<T> | (() => T);

/** Precedence levels below the route tree: defaults, then `document` of meeko.config.ts. */
const DEFAULT_LEVEL = -2;
const CONFIG_LEVEL = -1;
/** The route head (`export const head`, `route.head`, `useHead` in `<script server>`) wins over every component. */
export const ROUTE_LEVEL = Number.MAX_SAFE_INTEGER;

/** Comments around the tags that Meeko manages inside `<head>`. */
export const HEAD_START_MARKER = "meeko:head";
export const HEAD_END_MARKER = "/meeko:head";

const defaultViewport = "width=device-width,initial-scale=1";

/** Tags every Meeko document has unless the application replaces them. */
const defaultHead: HeadInput = { meta: [{ name: "viewport", content: defaultViewport }], link: [{ rel: "icon", href: "data:," }] };

function fail(label: string, message: string): never {
  throw new TypeError(`${label}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const attributeName = /^[A-Za-z][A-Za-z0-9_.:-]*$/;

function readAttributes(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(label, "must be an object of attribute values");
  const result: Record<string, string> = {};
  for (const [name, attribute] of Object.entries(value)) {
    if (!attributeName.test(name)) fail(label, `invalid attribute name ${JSON.stringify(name)}`);
    if (/^on/i.test(name)) fail(label, `event handler attribute ${name} is not allowed`);
    if (attribute === undefined) continue;
    if (typeof attribute !== "string") fail(label, `${name} must be a string or undefined`);
    result[name] = attribute;
  }
  return result;
}

function readFields<T>(value: unknown, label: string, fields: Readonly<Record<string, "string" | "boolean" | "crossorigin">>, required: readonly string[]): T {
  if (!isRecord(value)) fail(label, "must be an object");
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(value)) {
    const kind = fields[name];
    if (!kind) fail(label, `unknown field ${name}`);
    if (field === undefined) continue;
    if (kind === "boolean" ? typeof field !== "boolean" : typeof field !== "string") fail(label, `${name} must be a ${kind === "boolean" ? "boolean" : "string"}`);
    if (kind === "crossorigin" && !["", "anonymous", "use-credentials"].includes(field as string)) fail(label, 'crossorigin must be "", "anonymous" or "use-credentials"');
    result[name] = field;
  }
  for (const name of required) if (result[name] === undefined) fail(label, `${name} is required`);
  return result as T;
}

function readList<T>(value: unknown, label: string, read: (entry: unknown, label: string) => T): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(label, "must be an array");
  return value.map((entry, index) => read(entry, `${label}[${index}]`));
}

const metaFields = { name: "string", property: "string", httpEquiv: "string", content: "string", media: "string", key: "string" } as const;
const linkFields = { rel: "string", href: "string", hreflang: "string", type: "string", media: "string", sizes: "string", as: "string", crossorigin: "crossorigin", key: "string" } as const;
const scriptFields = { src: "string", type: "string", async: "boolean", defer: "boolean", module: "boolean", children: "string", key: "string" } as const;
const styleFields = { children: "string", media: "string", key: "string" } as const;

/** How {@link normalizeHeadInput} reads an input. */
interface NormalizeOptions {
  /** Rejects a function `titleTemplate`, which cannot be baked into the build or sent in a payload. */
  readonly serializable?: boolean;
  /** A route head, which also has `description`; as in 1.1, other unknown fields are ignored. */
  readonly page?: boolean;
}

/** Validates a head input and returns a copy without `undefined` fields. */
export function normalizeHeadInput(value: unknown, label: string, options: NormalizeOptions = {}): HeadInput & { description?: string } {
  const serializable = options.serializable === true;
  if (!isRecord(value)) fail(label, "must be an object");
  const allowed = new Set(["title", "titleTemplate", "meta", "link", "script", "style", "htmlAttrs", "bodyAttrs", ...options.page ? ["description"] : []]);
  for (const name of Object.keys(value)) {
    if (allowed.has(name) || options.page) continue;
    fail(label, name === "description" ? 'unknown field description; use meta: [{ name: "description", content }] or useSeoMeta' : `unknown field ${name}`);
  }
  const result: HeadInput & { description?: string } = {};
  if (value.title !== undefined) {
    if (typeof value.title !== "string") fail(label, "title must be a string");
    result.title = value.title;
  }
  if (value.description !== undefined) {
    if (typeof value.description !== "string") fail(label, "description must be a string");
    result.description = value.description;
  }
  const template = value.titleTemplate;
  if (template !== undefined) {
    if (typeof template === "function" && !serializable) result.titleTemplate = template as (title: string) => string;
    else if (typeof template === "string") result.titleTemplate = template;
    else fail(label, serializable ? "titleTemplate must be a string here, since it is serialized" : "titleTemplate must be a string or a function");
  }
  const meta = readList(value.meta, `${label}.meta`, (entry, at) => {
    const tag = readFields<HeadMeta>(entry, at, metaFields, ["content"]);
    if ([tag.name, tag.property, tag.httpEquiv].filter((field) => field !== undefined).length > 1) fail(at, "use only one of name, property and httpEquiv");
    return tag;
  });
  const link = readList(value.link, `${label}.link`, (entry, at) => readFields<HeadLink>(entry, at, linkFields, ["rel", "href"]));
  const script = readList(value.script, `${label}.script`, (entry, at) => {
    const tag = readFields<HeadScript>(entry, at, scriptFields, []);
    if ((tag.src === undefined) === (tag.children === undefined)) fail(at, "needs either src or children");
    return tag;
  });
  const style = readList(value.style, `${label}.style`, (entry, at) => readFields<HeadStyle>(entry, at, styleFields, ["children"]));
  const htmlAttrs = readAttributes(value.htmlAttrs, `${label}.htmlAttrs`);
  const bodyAttrs = readAttributes(value.bodyAttrs, `${label}.bodyAttrs`);
  if (meta) result.meta = meta;
  if (link) result.link = link;
  if (script) result.script = script;
  if (style) result.style = style;
  if (htmlAttrs) result.htmlAttrs = htmlAttrs;
  if (bodyAttrs) result.bodyAttrs = bodyAttrs;
  return result;
}

/**
 * Validates `document` of meeko.config.ts. It is baked into the build as JSON, so its
 * `titleTemplate` must be a string.
 */
export function normalizeDocumentConfig(value: unknown, label: string): DocumentConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) fail(label, "must be an object");
  for (const name of Object.keys(value)) if (!["lang", "head", "seo", "theme"].includes(name)) fail(label, `unknown field ${name}`);
  if (value.lang !== undefined && (typeof value.lang !== "string" || !value.lang)) fail(label, "lang must be a nonempty string");
  // Serializable: its titleTemplate is a string, as DocumentHead says.
  const head = value.head === undefined ? undefined : normalizeHeadInput(value.head, `${label}.head`, { serializable: true }) as DocumentHead;
  const seo = resolveSeo(value.seo, `${label}.seo`);
  const theme = resolveThemeConfig(value.theme, `${label}.theme`);
  return {
    ...(value.lang === undefined ? {} : { lang: value.lang as string }), ...(head ? { head } : {}), ...(seo ? { seo: { ...seo } } : {}),
    ...(theme ? { theme } : {}),
  };
}

/**
 * Combines head inputs into one, in order: `title` and `titleTemplate` of the last input that sets
 * them, tags concatenated (deduplication happens when the head resolves, later wins) and
 * attributes merged. Used for the route head and for `document` with the heads of modules.
 */
export function mergeHeadInputs(inputs: readonly (HeadInput | undefined)[]): HeadInput {
  const result: HeadInput = {};
  for (const input of inputs) {
    if (!input) continue;
    if (input.title !== undefined) result.title = input.title;
    if (input.titleTemplate !== undefined) result.titleTemplate = input.titleTemplate;
    for (const field of ["meta", "link", "script", "style"] as const) {
      const tags = input[field];
      if (tags?.length) (result as Record<string, unknown[]>)[field] = [...(result[field] ?? []), ...tags];
    }
    for (const field of ["htmlAttrs", "bodyAttrs"] as const) {
      const attributes = input[field];
      if (attributes) result[field] = { ...result[field], ...attributes };
    }
  }
  return result;
}

/**
 * `document` of meeko.config.ts as the build bakes it, with the heads that modules add placed
 * before the application's own, which wins. Returns `undefined` when there is nothing to render.
 */
export function resolveDocumentConfig(config: DocumentConfig | undefined, moduleHeads: readonly HeadInput[] = [], origin?: string, themeOption?: unknown): DocumentConfig | undefined {
  const heads = moduleHeads.map((head, index) => normalizeHeadInput(head, `module head ${index}`, { serializable: true }) as DocumentHead);
  // The module heads join `document.head`: their title is a site title too, never templated.
  const head = heads.length ? mergeHeadInputs([...heads, config?.head]) as DocumentHead : config?.head;
  const lang = config?.lang;
  // The build bakes the origin it resolved (`site` or MEEKO_PUBLIC_ORIGIN) into `seo`.
  const seo = resolveSeo(config?.seo, "document.seo", origin);
  // `theme` of meeko.config.ts, with every option decided: the server and the browser read the same.
  const theme = resolveThemeConfig(themeOption ?? config?.theme);
  if (lang === undefined && !seo && !theme && (!head || Object.keys(head).length === 0)) return undefined;
  return {
    ...(lang === undefined ? {} : { lang }), ...(head && Object.keys(head).length ? { head } : {}), ...(seo ? { seo: { ...seo } } : {}),
    ...(theme ? { theme } : {}),
  };
}

/** Key of the inline script and the inline style of the theme in `<head>`. */
const THEME_SCRIPT_KEY = "meeko:theme";

/**
 * The head input of a `document` configuration: `lang` becomes `htmlAttrs.lang`, and the theme
 * adds its inline script, which applies the stored theme before the first paint, and the style that
 * shows the icon of the choice in `<MeekoThemeToggle>`.
 */
export function documentHeadInput(config: DocumentConfig | undefined): HeadInput | undefined {
  if (!config) return undefined;
  if (documentHeads.has(config)) return documentHeads.get(config);
  const theme = resolveThemeConfig(config.theme, "document.theme");
  const head: HeadInput | undefined = theme
    ? {
      ...config.head,
      style: [{ key: THEME_SCRIPT_KEY, children: themeStyle(theme) }, ...config.head?.style ?? []],
      script: [{ key: THEME_SCRIPT_KEY, children: themeScript(theme) }, ...config.head?.script ?? []],
    }
    : config.head;
  const result = config.lang === undefined ? head : { ...head, htmlAttrs: { lang: config.lang, ...head?.htmlAttrs } };
  documentHeads.set(config, result);
  return result;
}

/** The head input of each document configuration: a server reads it on every request. */
const documentHeads = new WeakMap<DocumentConfig, HeadInput | undefined>();

/** Two document configurations, the second one winning. */
export function mergeDocumentConfigs(base: DocumentConfig | undefined, override: DocumentConfig | undefined): DocumentConfig | undefined {
  if (!base) return override;
  if (!override) return base;
  const lang = override.lang ?? base.lang;
  // The host's `seo` wins; without its own origin it keeps the one the build resolved.
  const seo = override.seo === undefined ? base.seo
    : resolveSeo(override.seo, "document.seo", typeof base.seo === "object" ? base.seo.origin : undefined);
  const theme = override.theme ?? base.theme;
  return {
    ...(lang === undefined ? {} : { lang }), head: mergeHeadInputs([base.head, override.head]) as DocumentHead, ...(seo === undefined ? {} : { seo }),
    ...(theme === undefined ? {} : { theme }),
  };
}

/** A resolved tag: what the server writes and the browser keeps in `<head>`. */
export interface HeadTag {
  readonly tag: "meta" | "link" | "script" | "style";
  readonly key: string;
  readonly attributes: ReadonlyArray<readonly [string, string | true]>;
  readonly children?: string;
  /** One of the default tags, which the server writes before the CSRF meta tag. */
  readonly fallback?: boolean;
}

/** The winning values of every head entry. */
export interface ResolvedHead {
  /**
   * The final title, or `undefined` without one: the winning title above the document config with
   * its template applied or, when there is none or it is empty, the document config's title as is.
   */
  readonly title: string | undefined;
  readonly htmlAttrs: ReadonlyMap<string, string>;
  readonly bodyAttrs: ReadonlyMap<string, string>;
  readonly tags: readonly HeadTag[];
}

function attributes(entries: ReadonlyArray<readonly [string, string | boolean | undefined]>): Array<readonly [string, string | true]> {
  const result: Array<readonly [string, string | true]> = [];
  for (const [name, value] of entries) {
    if (value === undefined || value === false) continue;
    result.push([name, value]);
  }
  return result;
}

function metaTag(meta: HeadMeta, fallback: boolean): HeadTag {
  const natural = meta.name !== undefined ? `name:${meta.name.toLowerCase()}`
    : meta.property !== undefined ? `property:${meta.property}`
      : meta.httpEquiv !== undefined ? `http-equiv:${meta.httpEquiv.toLowerCase()}`
        : `content:${meta.content}`;
  const media = meta.media === undefined ? "" : `|media:${meta.media}`;
  return {
    tag: "meta", key: meta.key !== undefined ? `meta:key:${meta.key}` : `meta:${natural}${media}`,
    attributes: attributes([["name", meta.name], ["property", meta.property], ["http-equiv", meta.httpEquiv], ["content", meta.content], ["media", meta.media]]),
    ...(fallback ? { fallback } : {}),
  };
}

function linkTag(link: HeadLink, fallback: boolean): HeadTag {
  const rel = link.rel.trim().toLowerCase();
  const natural = rel === "canonical" || rel === "icon" ? rel : `${rel}|${link.href}`;
  return {
    tag: "link", key: link.key !== undefined ? `link:key:${link.key}` : `link:${natural}`,
    attributes: attributes([
      ["rel", link.rel], ["href", link.href], ["hreflang", link.hreflang], ["type", link.type], ["media", link.media],
      ["sizes", link.sizes], ["as", link.as], ["crossorigin", link.crossorigin],
    ]),
    ...(fallback ? { fallback } : {}),
  };
}

function scriptTag(script: HeadScript): HeadTag {
  const natural = script.src !== undefined ? `src:${script.src}` : `inline:${script.children ?? ""}`;
  return {
    tag: "script", key: script.key !== undefined ? `script:key:${script.key}` : `script:${natural}`,
    attributes: attributes([["src", script.src], ["type", script.type ?? (script.module ? "module" : undefined)], ["async", script.async], ["defer", script.defer]]),
    ...(script.children === undefined ? {} : { children: script.children }),
  };
}

function styleTag(style: HeadStyle): HeadTag {
  return {
    tag: "style", key: style.key !== undefined ? `style:key:${style.key}` : `style:${style.children}`,
    attributes: attributes([["media", style.media]]),
    children: style.children,
  };
}

/** A head contribution with its precedence: a higher level wins, then a later order. */
export interface HeadEntry {
  readonly level: number;
  readonly order: number;
  readonly input: HeadInput | undefined;
}

function applyTemplate(title: string, template: HeadInput["titleTemplate"]): string {
  if (template === undefined) return title;
  return typeof template === "function" ? template(title) : template.replaceAll("%s", title);
}

/**
 * Resolves the head entries of a document: defaults, then entries by level and order. Tags are
 * deduplicated by key, the winner keeping the place where the key first appeared.
 *
 * The title of the document config (`CONFIG_LEVEL`) is the site title, the fallback of pages
 * without one: it is never templated. The template applies to the winning title of the levels
 * above it (layouts, pages, `useHead`, the route head); an empty one counts as no title, so the
 * site title shows instead of a template around nothing.
 */
export function resolveHead(entries: readonly HeadEntry[], page?: HeadPage): ResolvedHead {
  const sorted = [{ level: DEFAULT_LEVEL, order: -1, input: defaultHead }, ...entries]
    .filter((entry) => entry.input !== undefined)
    .sort((left, right) => left.level - right.level || left.order - right.order);
  let siteTitle: string | undefined;
  let title: string | undefined;
  let template: HeadInput["titleTemplate"];
  const htmlAttrs = new Map<string, string>();
  const bodyAttrs = new Map<string, string>();
  const tags = new Map<string, HeadTag>();
  for (const entry of sorted) {
    const input = entry.input!;
    const fallback = entry.level === DEFAULT_LEVEL;
    if (input.title !== undefined) {
      if (entry.level <= CONFIG_LEVEL) siteTitle = input.title;
      else title = input.title;
    }
    if (input.titleTemplate !== undefined) template = input.titleTemplate;
    for (const meta of input.meta ?? []) { const tag = metaTag(meta, fallback); tags.set(tag.key, tag); }
    for (const link of input.link ?? []) { const tag = linkTag(link, fallback); tags.set(tag.key, tag); }
    for (const style of input.style ?? []) { const tag = styleTag(style); tags.set(tag.key, tag); }
    for (const script of input.script ?? []) { const tag = scriptTag(script); tags.set(tag.key, tag); }
    for (const [name, value] of Object.entries(input.htmlAttrs ?? {})) if (value !== undefined) htmlAttrs.set(name, value);
    for (const [name, value] of Object.entries(input.bodyAttrs ?? {})) if (value !== undefined) bodyAttrs.set(name, value);
  }
  // The theme script goes right after the meta tags (a CSP meta tag still applies to it) and before
  // the links: a script after a pending stylesheet waits for it, and this one only reads the cookie.
  const themeScriptKey = `script:key:${THEME_SCRIPT_KEY}`;
  const order = ["meta", themeScriptKey, "link", "style", "script"];
  const rank = (tag: HeadTag): number => order.indexOf(tag.key === themeScriptKey ? themeScriptKey : tag.tag);
  // Without a page title, the site title as is; an empty page title with no site title stays empty.
  const resolvedTitle = title === undefined || title === "" ? siteTitle ?? title : applyTemplate(title, template);
  if (page?.seo) for (const tag of seoTags([...tags.values()], resolvedTitle, page.seo, page.pathname)) tags.set(tag.key, tag);
  return {
    title: resolvedTitle,
    htmlAttrs, bodyAttrs,
    tags: [...tags.values()].sort((left, right) => rank(left) - rank(right)),
  };
}

function attribute(tag: HeadTag, name: string): string | undefined {
  const value = tag.attributes.find(([key]) => key === name)?.[1];
  return typeof value === "string" ? value : undefined;
}

/**
 * The tags of `document.seo` that the resolved head lacks: a tag the page or the configuration
 * declares (under any key) always wins. The canonical URL and `og:url` need the origin and a page
 * pathname, which error pages do not have.
 */
function seoTags(tags: readonly HeadTag[], title: string | undefined, seo: ResolvedSeo, pathname: string | undefined): HeadTag[] {
  const hasMeta = (property: string): boolean => tags.some((tag) => tag.tag === "meta" && attribute(tag, "property") === property);
  const added: HeadTag[] = [];
  const meta = (property: string, content: string): void => {
    if (!hasMeta(property)) added.push(metaTag({ property, content }, false));
  };
  const url = pathname !== undefined && seo.origin !== undefined ? `${seo.origin}${pathname.startsWith("/") ? pathname : `/${pathname}`}` : undefined;
  if (url !== undefined && seo.ogUrl) meta("og:url", url);
  if (seo.ogTitle && title) meta("og:title", title);
  const description = tags.find((tag) => tag.tag === "meta" && attribute(tag, "name")?.toLowerCase() === "description");
  const descriptionText = description && attribute(description, "content");
  if (seo.ogDescription && descriptionText) meta("og:description", descriptionText);
  if (url !== undefined && seo.canonical && !tags.some((tag) => tag.tag === "link" && attribute(tag, "rel")?.trim().toLowerCase() === "canonical")) {
    added.push(linkTag({ rel: "canonical", href: url }, false));
  }
  return added;
}

const jsonScriptTypes = new Set(["application/json", "application/ld+json", "importmap", "speculationrules"]);

/**
 * Text of an inline `<script>` or `<style>`: never escaped, but it cannot close its element or
 * open a comment that would change how the browser parses the rest of the document.
 */
function rawText(tag: HeadTag): string {
  const text = tag.children ?? "";
  if (tag.tag === "script" && jsonScriptTypes.has(String(tag.attributes.find(([name]) => name === "type")?.[1] ?? "").toLowerCase())) {
    return text.replaceAll("<", "\\u003c");
  }
  const escaped = text.replaceAll("</", "<\\/");
  return tag.tag === "script" ? escaped.replaceAll("<!--", "<\\!--") : escaped;
}

function renderAttributes(entries: Iterable<readonly [string, string | true]>): string {
  let html = "";
  for (const [name, value] of entries) html += value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
  return html;
}

/** HTML of one resolved tag; inline scripts and styles, and external scripts, carry the CSP nonce. */
export function renderHeadTag(tag: HeadTag, nonce: string | undefined): string {
  const nonceAttribute = nonce && (tag.tag === "script" || tag.tag === "style") ? ` nonce="${escapeHtml(nonce)}"` : "";
  const open = `<${tag.tag}${renderAttributes(tag.attributes)}${nonceAttribute}>`;
  return tag.tag === "meta" || tag.tag === "link" ? open : `${open}${rawText(tag)}</${tag.tag}>`;
}

/** The parts of a Meeko document that the head decides. */
export interface HeadDocument {
  /** `<!doctype html><html …><head><meta charset>` and the default tags; the CSRF meta tag follows it. */
  readonly prefix: string;
  /** `<title>` and the managed tags between their markers. */
  readonly head: string;
  /** The `<body …>` open tag. */
  readonly bodyOpen: string;
}

/** Renders the resolved head of a server document. */
export function renderHeadDocument(head: ResolvedHead, nonce: string | undefined): HeadDocument {
  let prefix = `<!doctype html><html${renderAttributes(head.htmlAttrs)}><head><meta charset="utf-8">`;
  let managed = `<!--${HEAD_START_MARKER}-->`;
  if (head.title !== undefined) managed += `<title>${escapeHtml(head.title)}</title>`;
  for (const tag of head.tags) {
    if (tag.fallback) prefix += renderHeadTag(tag, nonce);
    else managed += renderHeadTag(tag, nonce);
  }
  return { prefix, head: `${managed}<!--${HEAD_END_MARKER}-->`, bodyOpen: `<body${renderAttributes(head.bodyAttrs)}>` };
}

/**
 * The route head as a head input: `description` is a description meta tag that wins over the
 * route's other tags, and an error page without a title takes `errorTitle`.
 */
export function routeHeadInput(head: HeadInput & { readonly description?: string | undefined }, errorTitle?: string): HeadInput {
  const { description, title, ...rest } = head;
  const resolvedTitle = title ?? errorTitle;
  return {
    ...rest,
    ...(resolvedTitle === undefined ? {} : { title: resolvedTitle }),
    ...(description === undefined ? {} : { meta: [...rest.meta ?? [], { name: "description", content: description }] }),
  };
}

/**
 * Collects the head entries of a server render. A suspended pass starts over with `clear`. Values
 * of getters and signals are read when the document is assembled, after the render.
 */
export class HeadCollector {
  readonly live = false;
  private readonly sources: Array<{ level: number; order: number; read: () => HeadInput }> = [];

  add(level: number, read: () => HeadInput): void {
    this.sources.push({ level, order: this.sources.length, read });
  }

  clear(): void {
    this.sources.length = 0;
  }

  entries(): HeadEntry[] {
    return this.sources.map(({ level, order, read }) => ({ level, order, input: normalizeHeadInput(read(), "useHead") }));
  }
}

/** The head entries of a document besides its components: `document` of the configuration and the route head. */
export function documentHeadEntries(config: DocumentConfig | undefined, route: HeadInput | undefined): HeadEntry[] {
  return [
    { level: CONFIG_LEVEL, order: 0, input: documentHeadInput(config) },
    { level: ROUTE_LEVEL, order: 0, input: route },
  ];
}

interface LiveEntry {
  level: number;
  order: number;
  input: HeadInput | undefined;
}

interface HeadManager {
  readonly live: boolean;
  add(level: number, read: () => HeadInput): void;
  register?(level: number): LiveEntry;
  update?(entry: LiveEntry, input: HeadInput | undefined): void;
  remove?(entry: LiveEntry): void;
}

// Pure: a component that only imports the runtime (no framework) leaves them out of its bundle.
const headManagerKey = /*#__PURE__*/ createContext<HeadManager>("Meeko head");
const headLevelKey = /*#__PURE__*/ createContext<number>("Meeko head level");

/** Makes a head manager available to the component tree of the active root. */
export function provideHead(manager: HeadCollector | BrowserHead): void {
  provide(headManagerKey, manager as HeadManager);
}

/**
 * Wraps a page, layout or `app.meeko` module so that the components it renders register their
 * head entries at `level`: `app.meeko` is 0, each layout one more and the page the deepest.
 */
export function withHeadLevel<M extends { renderWithState?: unknown; renderToString?: unknown; hydrateScope?: unknown }>(module: M, level: number): M {
  const scoped = <T>(work: () => T): T => createRoot((dispose) => {
    provide(headLevelKey, level);
    return finishWithCleanup(work, dispose);
  });
  const source = module as unknown as {
    renderWithState?: (props: Record<string, unknown>) => { html: string; state: Record<string, unknown> };
    renderToString?: (props: Record<string, unknown>, state?: Record<string, unknown>) => string;
    hydrateScope?: (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>) => ComponentRelease;
  };
  const wrapped: Record<string, unknown> = { ...module };
  if (source.renderWithState) wrapped.renderWithState = (props: Record<string, unknown>) => scoped(() => source.renderWithState!(props));
  if (source.renderToString) wrapped.renderToString = (props: Record<string, unknown>, state?: Record<string, unknown>) => scoped(() => source.renderToString!(props, state));
  if (source.hydrateScope) {
    wrapped.hydrateScope = (scope: DomScope, props: Record<string, unknown>, state?: Record<string, unknown>): ComponentRelease => createRoot((dispose) => {
      provide(headLevelKey, level);
      const release = source.hydrateScope!(scope, props, state);
      const result: ComponentRelease = () => finishWithCleanup(release, dispose);
      if (release.snapshot) result.snapshot = release.snapshot;
      return "exposed" in release ? Object.assign(result, { exposed: release.exposed }) : result;
    });
  }
  return wrapped as M;
}

/** Receives `useHead` of the top-level `<script server>` code of a page; set by the server handler. */
let pageHeadSink: ((read: () => HeadInput) => boolean) | undefined;

/** @internal The page body module routes `useHead` in top-level server code to its request. */
export function providePageHeadSink(sink: (read: () => HeadInput) => boolean): void {
  pageHeadSink = sink;
}

function reader<T>(source: HeadSource<T>): () => T {
  if (typeof source === "function") return source as () => T;
  if (typeof source === "object" && source !== null && "value" in source) return () => (source as ReadonlySignal<T>).value;
  return () => source as T;
}

/**
 * Añade etiquetas al `<head>` del documento y atributos a `<html>` y `<body>` mientras el componente
 * que la llama está montado. Funciona en páginas, layouts, `app/app.meeko`, componentes y
 * composables (en el nivel superior del script o en un composable que éste llama) y en el código
 * de nivel superior de `<script server>`, como alternativa a `export const head`.
 *
 * En el servidor, las entradas del render se escriben en `<head>` con los atributos escapados y el
 * nonce CSP en los `<script>` y `<style>`. En el navegador, la hidratación adopta las etiquetas del
 * SSR sin duplicarlas; un getter o una señal actualizan el documento cuando cambian, y las entradas
 * de los componentes que se desmontan al navegar desaparecen.
 *
 * Prioridad, de menor a mayor: `document` de `meeko.config.ts`, `app/app.meeko`, los layouts, la
 * página (y sus componentes) y el `head` de la ruta. Dentro de un mismo nivel gana la llamada
 * posterior. Las etiquetas se deduplican por `key` o por su clave natural: `name`, `property` o
 * `httpEquiv` en `meta`; `rel` y `href` en `link` (`canonical` e `icon` son únicos); `src` o el
 * código en `script`. Fuera de una aplicación de Meeko no hace nada.
 *
 * `titleTemplate` se aplica al título ganador de `app/app.meeko`, los layouts, la página y la
 * ruta. El `title` de `document.head` es el título del sitio: se muestra tal cual, sin plantilla,
 * cuando ningún nivel superior aporta un título o el que gana es una cadena vacía.
 *
 * @param input Entrada del head, o un getter o una señal que la devuelven.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const count = signal(0);
 * useHead(() => ({
 *   title: `${count.value} elementos`,
 *   meta: [{ name: "robots", content: "noindex" }],
 *   htmlAttrs: { class: count.value > 0 ? "busy" : undefined },
 * }));
 * </script>
 * <template><button on:click="count.value++">Añadir</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#head-del-documento-document-usehead-y-useseometa
 */
export function useHead(input: HeadSource<HeadInput>): void {
  if (isDryRender()) return;
  const read = reader(input);
  const manager = findContext(headManagerKey);
  if (!manager) {
    pageHeadSink?.(read);
    return;
  }
  const level = findContext(headLevelKey) ?? 0;
  if (!manager.live) {
    manager.add(level, read);
    return;
  }
  const entry = manager.register!(level);
  effect(() => manager.update!(entry, normalizeHeadInput(read(), "useHead")));
  onCleanup(() => manager.remove!(entry));
}

const seoNames: ReadonlyArray<readonly [keyof SeoMetaInput, "name" | "property", string]> = [
  ["description", "name", "description"],
  ["ogTitle", "property", "og:title"],
  ["ogDescription", "property", "og:description"],
  ["ogImage", "property", "og:image"],
  ["ogImageAlt", "property", "og:image:alt"],
  ["ogImageWidth", "property", "og:image:width"],
  ["ogImageHeight", "property", "og:image:height"],
  ["ogUrl", "property", "og:url"],
  ["ogType", "property", "og:type"],
  ["ogSiteName", "property", "og:site_name"],
  ["ogLocale", "property", "og:locale"],
  ["twitterCard", "name", "twitter:card"],
  ["twitterSite", "name", "twitter:site"],
  ["twitterCreator", "name", "twitter:creator"],
  ["twitterTitle", "name", "twitter:title"],
  ["twitterDescription", "name", "twitter:description"],
  ["twitterImage", "name", "twitter:image"],
  ["twitterImageAlt", "name", "twitter:image:alt"],
  ["robots", "name", "robots"],
  ["author", "name", "author"],
  ["keywords", "name", "keywords"],
  ["themeColor", "name", "theme-color"],
  ["colorScheme", "name", "color-scheme"],
  ["applicationName", "name", "application-name"],
  ["referrer", "name", "referrer"],
];

/** The head input of {@link useSeoMeta}. */
export function seoMetaHead(input: SeoMetaInput): HeadInput {
  if (!isRecord(input)) throw new TypeError("useSeoMeta: input must be an object");
  const known = new Set<string>(["title", "canonical", ...seoNames.map(([field]) => field)]);
  for (const name of Object.keys(input)) if (!known.has(name)) throw new TypeError(`useSeoMeta: unknown field ${name}`);
  const meta: HeadMeta[] = [];
  for (const [field, attribute, name] of seoNames) {
    const value = input[field];
    if (value === undefined || value === null) continue;
    meta.push({ [attribute]: name, content: String(value) } as HeadMeta);
  }
  const head: HeadInput = {};
  if (typeof input.title === "string") head.title = input.title;
  if (meta.length) head.meta = meta;
  if (typeof input.canonical === "string") head.link = [{ rel: "canonical", href: input.canonical }];
  return head;
}

/**
 * Atajo tipado de {@link useHead} para SEO: cada campo produce la etiqueta correcta, `name` en
 * `description`, `robots`, `theme-color` y las de Twitter, `property` en las de Open Graph, y
 * `<link rel="canonical">` en `canonical`. Acepta un getter o una señal, igual que `useHead`, y se
 * puede llamar en los mismos sitios.
 *
 * @param input Campos de SEO, o un getter o una señal que los devuelven.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ data: { title: string; summary: string; cover: string } }>();
 * useSeoMeta(() => ({
 *   title: props.data.title,
 *   description: props.data.summary,
 *   ogTitle: props.data.title,
 *   ogImage: props.data.cover,
 *   twitterCard: "summary_large_image",
 * }));
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#head-del-documento-document-usehead-y-useseometa
 */
export function useSeoMeta(input: HeadSource<SeoMetaInput>): void {
  const read = reader(input);
  useHead(() => seoMetaHead(read()));
}

/** Whether `element` already shows `tag`: the same name, attributes and text. */
function sameElement(element: Element, tag: HeadTag): boolean {
  if (element.localName !== tag.tag) return false;
  for (const [name, value] of tag.attributes) {
    const current = element.getAttribute(name);
    if (value === true ? current === null : current !== value) return false;
  }
  for (const attribute of [...element.attributes]) {
    if (attribute.name !== "nonce" && !tag.attributes.some(([name]) => name === attribute.name)) return false;
  }
  if (tag.tag === "meta" || tag.tag === "link") return true;
  // SSR wrote the escaped text; an element created in the browser holds the code as given.
  const text = element.textContent;
  return text === (tag.children ?? "") || text === rawText(tag);
}

function comment(node: Node, data: string): boolean {
  return node.nodeType === 8 && (node as Comment).data === data;
}

/**
 * The head of a browser application. It adopts the tags that SSR wrote between the head markers,
 * keeps them in sync with the mounted entries and restores what an entry replaced once it leaves.
 */
export class BrowserHead implements ThemeHead {
  readonly live = true;
  /** The theme of `<html>`, from the application's `BrowserTheme`. */
  private theme: DocumentTheme | undefined;
  private readonly entries = new Set<LiveEntry>();
  private readonly config: LiveEntry;
  private readonly route: LiveEntry = { level: ROUTE_LEVEL, order: 0, input: undefined };
  private order = 0;
  private holds = 0;
  private dirty = false;
  private disposed = false;
  private adopted = false;
  private start: Comment | undefined;
  private end: Comment | undefined;
  private readonly elements = new Map<string, Element>();
  private readonly attributeOwners = new Map<Element, Map<string, string | null>>();
  private readonly defaultTitle: string;
  private readonly nonce: string | undefined;
  private readonly seo: ResolvedSeo | undefined;
  /** Pathname of the committed page for `document.seo`; `undefined` on an error page. */
  private pathname: string | undefined;

  constructor(private readonly document: Document, config: DocumentConfig | undefined) {
    this.config = { level: CONFIG_LEVEL, order: 0, input: documentHeadInput(config) };
    this.seo = resolveSeo(config?.seo, "document.seo");
    const head = document.head;
    if (head) {
      for (const node of [...head.childNodes]) {
        if (comment(node, HEAD_START_MARKER)) this.start ??= node as Comment;
        else if (comment(node, HEAD_END_MARKER) && this.start) this.end ??= node as Comment;
      }
    }
    // The host's title outside the markers is what a page without a title shows.
    const titles = [...document.head?.querySelectorAll("title") ?? []];
    const host = titles.find((title) => !this.inside(title));
    this.defaultTitle = (host?.textContent ?? "").replace(/[\t\n\f\r ]+/g, " ").replace(/^ | $/g, "");
    const script = document.querySelector<HTMLScriptElement>("script[nonce]");
    this.nonce = script ? script.nonce || script.getAttribute("nonce") || undefined : undefined;
  }

  private inside(node: Node): boolean {
    if (!this.start || !this.end) return false;
    for (let current = this.start.nextSibling; current && current !== this.end; current = current.nextSibling) if (current === node) return true;
    return false;
  }

  add(): void {
    throw new Error("A browser head registers live entries");
  }

  register(level: number): LiveEntry {
    const entry: LiveEntry = { level, order: ++this.order, input: undefined };
    this.entries.add(entry);
    return entry;
  }

  update(entry: LiveEntry, input: HeadInput | undefined): void {
    entry.input = input;
    if (this.entries.has(entry)) this.changed();
  }

  remove(entry: LiveEntry): void {
    if (this.entries.delete(entry)) this.changed();
  }

  /**
   * Replaces the route head: the payload or the client route `head` of the committed page, and
   * its pathname for `document.seo` (`undefined` on an error page).
   */
  setRoute(input: HeadInput | undefined, pathname?: string): void {
    this.route.input = input;
    this.pathname = pathname;
    this.changed();
  }

  /**
   * Replaces the theme attributes of `<html>`. Before hydration adopts the SSR head nothing is
   * written: the inline script already applied the same theme, and the first flush keeps it.
   */
  setTheme(theme: DocumentTheme | undefined): void {
    this.theme = theme;
    if (this.adopted) this.changed();
  }

  /** Runs `work` with updates deferred until it finishes, then applies them once. */
  hold<T>(work: () => T): T {
    this.holds++;
    let completed = false;
    try {
      const result = work();
      completed = true;
      return result;
    } finally {
      this.holds--;
      // A failed hydration leaves the SSR head untouched; a failed navigation shows what stays mounted.
      if (this.holds === 0 && this.dirty && (completed || this.adopted)) this.flush();
    }
  }

  /** Stops updating the document; a disposed application leaves its head as it is. */
  dispose(): void {
    this.disposed = true;
  }

  private changed(): void {
    this.dirty = true;
    if (this.holds === 0) this.flush();
  }

  private flush(): void {
    this.dirty = false;
    if (this.disposed) return;
    const resolved = resolveHead([this.config, ...this.entries, this.route], { seo: this.seo, pathname: this.pathname });
    const document = this.document;
    const title = resolved.title ?? this.defaultTitle;
    if (document.title !== title) document.title = title;
    this.syncAttributes(document.documentElement, withThemeAttributes(resolved.htmlAttrs, this.theme, true));
    // After the attributes: a `class` of htmlAttrs replaces the attribute and its theme class, and
    // a `style` the attribute and its color-scheme.
    applyThemeClass(document.documentElement, this.theme);
    applyColorScheme(document.documentElement, this.theme);
    if (document.body) this.syncAttributes(document.body, resolved.bodyAttrs);
    this.syncTags(resolved.tags);
    this.adopted = true;
  }

  private syncAttributes(element: Element, desired: ReadonlyMap<string, string>): void {
    let owned = this.attributeOwners.get(element);
    if (!owned) this.attributeOwners.set(element, owned = new Map());
    for (const [name, previous] of owned) {
      if (desired.has(name)) continue;
      if (previous === null) element.removeAttribute(name);
      else element.setAttribute(name, previous);
      owned.delete(name);
    }
    for (const [name, value] of desired) {
      // SSR wrote the attributes of the first resolution; one added later restores what it replaced.
      if (!owned.has(name)) owned.set(name, this.adopted ? element.getAttribute(name) : null);
      if (element.getAttribute(name) !== value) element.setAttribute(name, value);
    }
  }

  private markers(): Comment {
    if (!this.start || !this.end) {
      const head = this.document.head ?? this.document.documentElement;
      this.start = this.document.createComment(HEAD_START_MARKER);
      this.end = this.document.createComment(HEAD_END_MARKER);
      head.append(this.start, this.end);
    }
    return this.end;
  }

  private create(tag: HeadTag): Element {
    const element = this.document.createElement(tag.tag);
    for (const [name, value] of tag.attributes) element.setAttribute(name, value === true ? "" : value);
    if (this.nonce && (tag.tag === "script" || tag.tag === "style")) element.setAttribute("nonce", this.nonce);
    if (tag.children !== undefined) element.textContent = tag.children;
    return element;
  }

  private syncTags(tags: readonly HeadTag[]): void {
    const end = this.markers();
    if (!this.adopted) {
      // Hydration: claim the tags SSR wrote; the default ones sit before the markers.
      const managed: Element[] = [];
      for (let node = this.start!.nextSibling; node && node !== end; node = node.nextSibling) {
        if (node.nodeType === 1 && (node as Element).localName !== "title") managed.push(node as Element);
      }
      const head = this.document.head;
      const fallbacks = head ? [...head.children].filter((element) => !managed.includes(element) && !this.inside(element)) : [];
      for (const tag of tags) {
        const pool = tag.fallback ? fallbacks : managed;
        const index = pool.findIndex((element) => sameElement(element, tag));
        if (index < 0) continue;
        this.elements.set(tag.key, pool[index]!);
        pool.splice(index, 1);
      }
      // What SSR managed and this resolution does not want is stale.
      for (const element of managed) element.remove();
    }
    const wanted = new Set(tags.map((tag) => tag.key));
    for (const [key, element] of this.elements) {
      if (wanted.has(key)) continue;
      element.remove();
      this.elements.delete(key);
    }
    for (const tag of tags) {
      const current = this.elements.get(tag.key);
      if (current && sameElement(current, tag)) continue;
      const element = this.create(tag);
      // A changed script is a new element, so the browser runs it.
      if (current) current.replaceWith(element);
      else end.parentNode!.insertBefore(element, end);
      this.elements.set(tag.key, element);
    }
  }
}
