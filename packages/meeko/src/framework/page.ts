import type { SitemapEntriesContext, SitemapEntry } from "./config-type.js";
import type { StateStore } from "./state.js";
import { normalizeHeadInput } from "./head.js";
import type { HeadInput } from "./head.js";
import type { LayoutProps, PageLayoutOptions } from "./layout.js";
import type { ClientRouteMiddlewareName, RouteMiddlewareName } from "./middleware.js";

/**
 * Subconjunto de Standard Schema v1 que se puede usar en el navegador, como el que implementan los
 * schemas de Valibot. Valida `params` y `search` de una página.
 *
 * @typeParam I Tipo de entrada.
 * @typeParam O Tipo de salida, tras validar y transformar.
 * @example
 * ```ts
 * import * as v from "valibot";
 * import type { PageSchema } from "@meekojs/meeko/framework";
 *
 * const params: PageSchema<{ id: string }> = v.object({ id: v.string() });
 * ```
 */
export interface PageSchema<I = unknown, O = I> {
  /** Interfaz Standard Schema v1: `validate` devuelve el valor de salida o la lista de `issues`. */
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) =>
      | { value: O; issues?: undefined }
      | { issues: readonly unknown[] }
      | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type Output<S> = S extends PageSchema<unknown, infer O> ? O : never;
type Params<P> = P extends PageSchema ? Output<P> : Readonly<Record<string, string>>;
type Search<S> = S extends PageSchema ? Output<S> : Readonly<Record<string, string | string[]>>;

/**
 * Contexto que reciben `load` y `head` de una página renderizada en el servidor. `params` y
 * `search` ya están validados por los schemas de la ruta.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @typeParam C Tipo del contexto de la petición.
 * @example
 * ```ts
 * import { definePage } from "@meekojs/meeko/framework";
 * import type { PageLoadContext } from "@meekojs/meeko/framework";
 *
 * async function load({ params, signal, state }: PageLoadContext<undefined, undefined>) {
 *   state.get("visits", () => 0).value++;
 *   return (await fetch(`https://api.example.com/posts/${params.id}`, { signal })).json();
 * }
 * export const route = definePage({ load });
 * ```
 */
export interface PageLoadContext<P extends PageSchema | undefined, S extends PageSchema | undefined, C = unknown> {
  /** Parámetros de la ruta. */
  readonly params: Params<P>;
  /** Parámetros de búsqueda. */
  readonly search: Search<S>;
  /** Petición HTTP de la página. */
  readonly request: Request;
  /** Se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. */
  readonly signal: AbortSignal;
  /** Estado de `useState` de la petición. */
  readonly state: StateStore;
  /** Contexto de la petición (`RequestContext` en `createServerApp`): sesión, servicios y plataforma. */
  readonly context?: C;
}

/**
 * Cómo llega una página al navegador:
 * - `"ssr"` (por defecto): HTML completo en cada petición.
 * - `"stream"`: envía el HTML antes de que se resuelvan sus valores `defer` y los transmite después.
 * - `"prerender"`: HTML generado en `meeko build`.
 * - `"client"`: el servidor renderiza los layouts y el navegador ejecuta el loader, `head` y la página.
 *
 * Puede ganar miembros en un minor: un `switch` exhaustivo necesita rama por defecto.
 *
 * @example
 * ```ts
 * import type { PageRender } from "@meekojs/meeko/framework";
 *
 * function indexable(render: PageRender = "ssr"): boolean {
 *   return render === "ssr" || render === "prerender";
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#modos-de-render
 */
export type PageRender = "ssr" | "stream" | "prerender" | "client";

/**
 * Contexto del loader de una página `render: "client"`, que se ejecuta en el navegador sin
 * `request` ni `context`.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @example
 * ```ts
 * import { definePage } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   render: "client",
 *   load: async ({ url, signal }) => api.notes.list({ query: { q: url.searchParams.get("q") ?? "" }, signal }),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#modos-de-render
 */
export interface ClientPageLoadContext<P extends PageSchema | undefined, S extends PageSchema | undefined> {
  /** URL de destino. */
  readonly url: URL;
  /** Parámetros de la ruta. */
  readonly params: Params<P>;
  /** Parámetros de búsqueda. */
  readonly search: Search<S>;
  /** Se aborta si la navegación se cancela. */
  readonly signal: AbortSignal;
  /** Estado provisional, que se aplica al confirmar la ruta. */
  readonly state: StateStore;
}

/**
 * Metadatos del documento que devuelve el `head` de una página. Sin `title` se conserva el del
 * host, o ninguno. Desde `1.2` admite también las etiquetas y los atributos de {@link HeadInput}
 * (con `titleTemplate` sólo como cadena, porque viaja en el payload de navegación); el `head` de la
 * ruta tiene la máxima prioridad frente a `useHead`.
 *
 * @example
 * ```ts
 * import { definePage } from "@meekojs/meeko/framework";
 * import type { PageHead } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   load: () => ({ name: "Ada", avatar: "https://example.com/ada.png" }),
 *   head: ({ data }): PageHead => ({
 *     title: `Perfil de ${data.name}`,
 *     meta: [{ property: "og:image", content: data.avatar }],
 *   }),
 * });
 * ```
 */
export interface PageHead extends Omit<HeadInput, "title" | "titleTemplate"> {
  /** Título del documento: `<title>` en SSR y `document.title` al navegar. */
  readonly title?: string;
  /**
   * Descripción del documento: `<meta name="description">` en SSR y en el prerender, actualizada al
   * navegar. Una página sin descripción conserva la del host, o ninguna.
   * @since 1.1.0
   */
  readonly description?: string;
  /**
   * Plantilla del título, con `%s` en el lugar del título.
   * @since 1.2.0
   */
  readonly titleTemplate?: string;
}

/**
 * The fields of a page head that travel in the payload, validated. A function `titleTemplate`
 * cannot travel and fails.
 */
export function payloadHead(head: PageHead): PageHead {
  return normalizeHeadInput(head, "page head", { serializable: true, page: true }) as PageHead;
}

/**
 * Version of the SSR hydration and navigation payload. Version 2 added the
 * `deferred` list, `null` placeholders at deferred paths and the ndjson
 * navigation stream of `render: "stream"` routes.
 */
export const PAYLOAD_VERSION = 2;

/**
 * `document.title` of the error page (`+error.meeko` or `app/error.meeko`) shown for a failure of
 * a matched route, such as `notFound()` or a loader error, and of the 404 page of a URL without a
 * route: in the SSR document and after a browser navigation.
 */
export const ERROR_PAGE_TITLE = "Error";

/**
 * Contexto que recibe `cache.etag` de una página, antes del loader y del render: la petición, ya
 * validada por los schemas de la ruta, sin estado ni datos.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @typeParam C Tipo del contexto de la petición.
 * @since 1.7.0
 * @example
 * ```ts
 * import type { PageCacheContext } from "@meekojs/meeko/framework";
 *
 * const etag = ({ params }: PageCacheContext<undefined, undefined>) => docs.versionOf(params.slug);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#caché-de-páginas-ssr
 */
export interface PageCacheContext<P extends PageSchema | undefined, S extends PageSchema | undefined, C = unknown> {
  /** URL de la petición. */
  readonly url: URL;
  /** Parámetros de la ruta, validados. */
  readonly params: Params<P>;
  /** Parámetros de búsqueda, validados. */
  readonly search: Search<S>;
  /** Petición HTTP de la página. */
  readonly request: Request;
  /** Se aborta si el cliente se desconecta. */
  readonly signal: AbortSignal;
  /** Contexto de la petición (`RequestContext` en `createServerApp`): servicios y plataforma. */
  readonly context?: C;
}

/**
 * Límites de la caché en memoria de una página (`cache.memory`), por ruta y por proceso.
 *
 * @since 1.7.0
 * @example
 * ```ts
 * import type { PageMemoryCache } from "@meekojs/meeko/framework";
 *
 * const memory: PageMemoryCache = { maxEntries: 200, maxBytes: 8 * 1024 * 1024 };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#caché-de-páginas-ssr
 */
export interface PageMemoryCache {
  /** Respuestas guardadas como máximo; al superarlo sale la menos usada. Por defecto, `1000`. */
  readonly maxEntries?: number;
  /** Bytes (UTF-8) de los cuerpos guardados como máximo. Por defecto, 32 MiB. */
  readonly maxBytes?: number;
}

/**
 * Caché HTTP de una página que se renderiza en el servidor (`definePage({ cache })`). Sólo se
 * aplica en producción, a peticiones `GET` y `HEAD` sin sesión: una petición con la cookie de
 * sesión, o una respuesta que pone una cookie, sale como siempre, con `no-store`.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @typeParam C Tipo del contexto de la petición.
 * @since 1.7.0
 * @example
 * ```ts
 * import { definePage } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   cache: { etag: ({ params }) => docs.versionOf(params.slug), maxAge: 60, memory: true },
 *   load: ({ params }) => docs.get(params.slug),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#caché-de-páginas-ssr
 */
export interface PageCache<P extends PageSchema | undefined = undefined, S extends PageSchema | undefined = undefined, C = unknown> {
  /**
   * Versión del contenido de la página, que se calcula antes del loader y del render y debe ser
   * barata (una fecha de modificación, un contador). Meeko la combina con el tema, el build y el
   * tipo de respuesta (documento o payload) en un `ETag` débil; si coincide con `If-None-Match`,
   * responde `304` sin ejecutar el loader ni el render. Debe cambiar con todo lo que cambia el HTML
   * salvo el tema. `undefined` deja esta respuesta sin `ETag`.
   */
  readonly etag?: (args: PageCacheContext<P, S, C>) => string | number | undefined | Promise<string | number | undefined>;
  /** Segundos que el navegador o una CDN pueden servir la copia sin preguntar (`max-age`). Por defecto, `0`. */
  readonly maxAge?: number;
  /** Segundos que pueden servir una copia caducada mientras la revalidan (`stale-while-revalidate`). */
  readonly staleWhileRevalidate?: number;
  /**
   * Guarda en la memoria del proceso el HTML y el payload renderizados, por URL, tema y `ETag`, y
   * los sirve sin loader ni render mientras `etag` devuelva lo mismo. Necesita `etag`. No se aplica
   * a `render: "stream"`, que sólo usa el `ETag`.
   */
  readonly memory?: boolean | PageMemoryCache;
}

/** `cache` of a page, validated, with its defaults. */
export interface ResolvedPageCache {
  readonly etag?: (args: PageCacheContext<PageSchema | undefined, PageSchema | undefined, unknown>) => unknown;
  readonly maxAge: number;
  readonly staleWhileRevalidate?: number;
  readonly memory?: { readonly maxEntries: number; readonly maxBytes: number };
}

const seconds = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;
const positive = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) > 0;

/** Validates `cache` of route options, naming `label` in the errors; `undefined` without one. */
export function resolvePageCache(value: unknown, label: string): ResolvedPageCache | undefined {
  if (value === undefined) return undefined;
  if (!record(value)) throw new TypeError(`${label}: cache must be an object like { etag, maxAge, memory }`);
  for (const key of Object.keys(value)) {
    if (!["etag", "maxAge", "staleWhileRevalidate", "memory"].includes(key)) throw new TypeError(`${label}: cache has an unknown field ${key}`);
  }
  if (value.etag !== undefined && typeof value.etag !== "function") throw new TypeError(`${label}: cache.etag must be a function`);
  if (value.maxAge !== undefined && !seconds(value.maxAge)) throw new TypeError(`${label}: cache.maxAge must be a whole number of seconds`);
  if (value.staleWhileRevalidate !== undefined && !seconds(value.staleWhileRevalidate)) throw new TypeError(`${label}: cache.staleWhileRevalidate must be a whole number of seconds`);
  let memory: ResolvedPageCache["memory"];
  if (value.memory !== undefined && value.memory !== false) {
    const limits = value.memory === true ? {} : value.memory;
    if (!record(limits)) throw new TypeError(`${label}: cache.memory must be a boolean or { maxEntries, maxBytes }`);
    for (const key of Object.keys(limits)) if (key !== "maxEntries" && key !== "maxBytes") throw new TypeError(`${label}: cache.memory has an unknown field ${key}`);
    if (limits.maxEntries !== undefined && !positive(limits.maxEntries)) throw new TypeError(`${label}: cache.memory.maxEntries must be a positive integer`);
    if (limits.maxBytes !== undefined && !positive(limits.maxBytes)) throw new TypeError(`${label}: cache.memory.maxBytes must be a positive integer`);
    // Without an ETag nothing would tell a stored page from a changed one.
    if (value.etag === undefined) throw new TypeError(`${label}: cache.memory needs cache.etag, which tells when a stored page changed`);
    memory = { maxEntries: (limits.maxEntries as number | undefined) ?? 1000, maxBytes: (limits.maxBytes as number | undefined) ?? 32 * 1024 * 1024 };
  }
  return {
    ...(value.etag ? { etag: value.etag as NonNullable<ResolvedPageCache["etag"]> } : {}),
    maxAge: (value.maxAge as number | undefined) ?? 0,
    ...(value.staleWhileRevalidate === undefined ? {} : { staleWhileRevalidate: value.staleWhileRevalidate as number }),
    ...(memory ? { memory } : {}),
  };
}

/**
 * Opciones de ruta de una página que se renderiza en el servidor (`"ssr"`, el modo por defecto,
 * `"stream"` o `"prerender"`). Se declaran con {@link definePage} en `<script server>` o en un
 * sidecar `*.route.ts`, que nunca llegan al navegador.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @typeParam D Datos que devuelve `load`.
 * @typeParam C Tipo del contexto de la petición.
 * @example
 * ```ts
 * import * as v from "valibot";
 * import { definePage } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   render: "prerender",
 *   params: v.object({ slug: v.string() }),
 *   prerenderEntries: [{ slug: "hola" }, { slug: "adios" }],
 *   load: ({ params }) => ({ slug: params.slug }),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#opciones-de-ruta-con-definepage
 */
export interface PageDefinition<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C = unknown> {
  /**
   * Schema de los parámetros de la ruta (los segmentos `[id]` del archivo), que se validan antes de
   * `load` y del código de nivel superior; una entrada inválida responde `400`. Sin schema, `params`
   * son los segmentos como texto.
   */
  readonly params?: P;
  /**
   * Schema de los parámetros de búsqueda; una entrada inválida responde `400`. Sin schema, cada
   * clave es un texto, o una lista si se repite en la URL.
   */
  readonly search?: S;
  /**
   * Cómo llega la página al navegador: `"ssr"` la renderiza en cada petición, `"stream"` envía el
   * HTML antes de sus valores `defer` y `"prerender"` genera el HTML en `meeko build`. Para
   * renderizarla en el navegador, `"client"` (véase {@link ClientPageDefinition}). Debe ser un
   * literal, porque `meeko build` lo lee sin ejecutar el archivo.
   *
   * @defaultValue `"ssr"`
   */
  readonly render?: Exclude<PageRender, "client">;
  /**
   * Parámetros de cada URL que `meeko build` prerenderiza en una ruta dinámica con
   * `render: "prerender"`, o una función asíncrona que los devuelve. Una ruta estática se
   * prerenderiza sin ellos, y `"ssr"` y `"stream"` los ignoran.
   */
  readonly prerenderEntries?: readonly Readonly<Record<string, string>>[] | (() => Promise<readonly Readonly<Record<string, string>>[]>);
  /**
   * URL de la ruta que `meeko build` añade a `sitemap.xml` (con `sitemap` en `meeko.config.ts`): una
   * lista de {@link SitemapEntry} o una función, síncrona o asíncrona, que la devuelve y recibe
   * {@link SitemapEntriesContext}. Sirve sobre todo para las rutas dinámicas con `"ssr"` o
   * `"stream"`, que el build no conoce. En una ruta `"prerender"` sólo añade `lastmod`, `changefreq`
   * y `priority` a sus páginas prerenderizadas: una entrada sin página detiene el build. `exclude` y
   * `noindex` siguen ganando.
   * @since 1.7.0
   */
  readonly sitemapEntries?: readonly SitemapEntry[] | ((context: SitemapEntriesContext) => readonly SitemapEntry[] | Promise<readonly SitemapEntry[]>);
  /**
   * Loader del servidor: se ejecuta en cada petición de la página (en SSR y en la petición de datos
   * de una navegación), o una vez por URL durante `meeko build` con `"prerender"`. Lo que devuelve
   * llega a la página como `props.data`, que pasa a ser obligatorio. Puede devolver un `Response`
   * para redirigir y valores `defer`, que `"stream"` envía después del HTML.
   */
  readonly load?: (args: PageLoadContext<P, S, C>) => Promise<D> | D;
  /**
   * Calcula el head de la página con los datos del loader: `title`, `description` y, desde `1.2`,
   * las etiquetas de `useHead`. Tiene prioridad sobre `useHead` y sobre el `document` de la
   * configuración.
   */
  readonly head?: (args: PageLoadContext<P, S, C> & { data: D }) => PageHead;
  /**
   * Layout con nombre de la página (`app/layouts/<nombre>.meeko`), o `false` para quitarlo y dejar
   * sólo `app/app.meeko`. Sin él, el de los `+group.ts` de sus carpetas o `default`. Debe ser un
   * literal, porque `meeko build` lo lee sin ejecutar el archivo. En `definePage`, su tipo es la unión
   * de los layouts de la aplicación.
   * @since 1.5.0
   */
  readonly layout?: unknown;
  /**
   * Props para el layout de la página: un objeto o una función que las calcula con el contexto de
   * `head` (`data` incluido). Se combinan con las de los `+group.ts`, a las que ganan. Llegan en el
   * HTML del servidor y en el payload, así que deben poder serializarse en JSON. En `definePage` se
   * tipan contra las props del layout que elige `layout`.
   * @since 1.5.0
   */
  readonly layoutProps?: unknown;
  /**
   * Middleware con nombre de `app/middleware` que la página añade, después de los globales y de los
   * de sus `+group.ts`, o `false` para quitar los heredados. Debe ser un array literal de nombres,
   * porque `meeko build` lo lee sin ejecutar el archivo; su tipo es la unión de los middleware con
   * nombre de la aplicación.
   * @since 1.6.0
   */
  readonly middleware?: readonly RouteMiddlewareName[] | false;
  /**
   * Caché HTTP de la página: `ETag` (con `304` sin loader ni render), `max-age`,
   * `stale-while-revalidate` y, con `memory`, una caché en memoria del HTML renderizado. Sólo en
   * producción y para peticiones sin sesión (véase {@link PageCache}). Se lee al ejecutar la ruta,
   * como `load`.
   * @since 1.7.0
   */
  readonly cache?: PageCache<P, S, C>;
}

/**
 * Opciones de ruta de una página que se renderiza en el navegador (`render: "client"`). Su bloque
 * o sidecar entra en el bundle del cliente, así que no puede importar módulos de servidor; los
 * datos deben llegar por endpoints de API o RPC protegidos.
 *
 * @typeParam P Schema de `params`, o `undefined`.
 * @typeParam S Schema de `search`, o `undefined`.
 * @typeParam D Datos que devuelve `load`.
 * @example
 * ```ts
 * import { definePage } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   render: "client",
 *   load: async ({ signal }) => api.notes.list({ signal }),
 *   head: ({ data }) => ({ title: `${data.length} notas` }),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#modos-de-render
 */
export interface ClientPageDefinition<P extends PageSchema | undefined, S extends PageSchema | undefined, D> {
  /** Schema de los parámetros de la ruta. El servidor los valida antes de enviar los layouts; una entrada inválida responde `400`. */
  readonly params?: P;
  /** Schema de los parámetros de búsqueda, que se validan como `params`. */
  readonly search?: S;
  /**
   * El servidor sólo renderiza los layouts y el navegador ejecuta `load`, `head` y la página. El
   * HTML inicial no lleva los datos: es para vistas sin requisitos de SEO.
   */
  readonly render: "client";
  /** Una página `"client"` no se puede prerenderizar: declararlo es un error de tipos y detiene `meeko build`. */
  readonly prerenderEntries?: never;
  /**
   * Una página `"client"` no declara URL del sitemap: sus opciones llegan al navegador. Declararlo es
   * un error de tipos y detiene `meeko build`; una ruta sin parámetros ya está en el sitemap.
   * @since 1.7.0
   */
  readonly sitemapEntries?: never;
  /**
   * Loader del navegador, con {@link ClientPageLoadContext} (sin `request` ni `context`): pide los
   * datos a la API o al RPC. Lo que devuelve llega a la página como `props.data`.
   */
  readonly load?: (args: ClientPageLoadContext<P, S>) => Promise<D> | D;
  /** Se ejecuta en el navegador después de `load`; su head se aplica al confirmar la página. */
  readonly head?: (args: ClientPageLoadContext<P, S> & { data: D }) => PageHead;
  /**
   * Layout con nombre de la página, como en {@link PageDefinition.layout}.
   * @since 1.5.0
   */
  readonly layout?: unknown;
  /**
   * Props para el layout: un objeto, que el servidor ya aplica al HTML de los layouts, o una función
   * que se ejecuta en el navegador después de `load`.
   * @since 1.5.0
   */
  readonly layoutProps?: unknown;
  /**
   * Middleware con nombre de la página, como en {@link PageDefinition.middleware}, sin los de
   * servidor (`*.server.ts`): una página `render: "client"` no pide sus datos al servidor al navegar.
   * @since 1.6.0
   */
  readonly middleware?: readonly ClientRouteMiddlewareName[] | false;
  /**
   * Una página `"client"` no tiene caché de servidor: su HTML sólo lleva los layouts, y sus datos
   * llegan por API o RPC. Declararla es un error de tipos y falla al cargar la ruta.
   * @since 1.7.0
   */
  readonly cache?: never;
}

/** `layout` and `layoutProps` of server route options, typed against the chosen layout. */
type ServerLayout<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C> = PageLayoutOptions<PageLoadContext<P, S, C> & { data: D }>;
/** `layout` and `layoutProps` of browser route options, typed against the chosen layout. */
type ClientLayout<P extends PageSchema | undefined, S extends PageSchema | undefined, D> = PageLayoutOptions<ClientPageLoadContext<P, S> & { data: D }>;
/** Route options of any mode, with their layout options. */
type AnyPageDefinition<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C> =
  | (PageDefinition<P, S, D, C> & ServerLayout<P, S, D, C>)
  | (ClientPageDefinition<P, S, D> & ClientLayout<P, S, D>);
/** What `definePage` reads from the options as written: any of them, so options with only `layout` are options too. */
interface WrittenOptions { readonly render?: PageRender; readonly load?: unknown; readonly layout?: unknown; readonly layoutProps?: unknown; readonly cache?: unknown }
/**
 * `T` absorbs the keys it is written with, so a key that the chosen layout does not declare would
 * pass: it must be `never`.
 */
type ExactLayoutProps<T> = T extends { readonly layout: infer L extends string; readonly layoutProps: infer O }
  ? O extends (...args: never[]) => infer R ? { readonly layoutProps: (...args: never[]) => ExactProps<R, LayoutProps<L>> }
    : { readonly layoutProps: ExactProps<O, LayoutProps<L>> }
  : unknown;
/** `Written` with each key of `Declared` at its declared type, and every other key `never`. */
type ExactProps<Written, Declared> = { readonly [K in keyof Written]: K extends keyof Declared ? Declared[K] : never };

declare const typeArgumentsNotWritten: unique symbol;
/**
 * Default of the type parameters that `definePage` can only learn from written type arguments: `T`
 * of the first signature and `D` of the overloads for written type arguments. No options object
 * has its key, so a signature that gets it rejects the call before typing `load` and `head`.
 */
interface TypeArgumentsNotWritten { readonly [typeArgumentsNotWritten]: true }

/** `X`, or an object that nothing matches when `D` was not written. */
type WhenWritten<D, X> = [D] extends [TypeArgumentsNotWritten] ? TypeArgumentsNotWritten : X;

/** The result of `definePage` for the options `T` as written: the type of their mode, with `load` required when declared. */
type DefinedPage<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C, T> = DefinedMode<P, S, D, C, T> & WrittenLayout<T>;
/** The layout options as written, which `meeko check` compares with the layout the page inherits. */
type WrittenLayout<T> = (T extends { readonly layout: infer L } ? { readonly layout: L } : unknown) & (T extends { readonly layoutProps: infer L } ? { readonly layoutProps: L } : unknown);
/** The options of the mode of `T`. */
type DefinedMode<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C, T> = T extends { readonly render: "client" }
  ? T extends { readonly load: unknown }
    ? ClientPageDefinition<P, S, D> & { readonly load: NonNullable<ClientPageDefinition<P, S, D>["load"]> }
    : ClientPageDefinition<P, S, D>
  : T extends { readonly load: unknown }
    ? PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> }
    : PageDefinition<P, S, D, C>;

// One signature for every mode, first: while a call does not type-check yet, the editor completes
// `render` from the first overload alone, which with one overload per mode offered only "client".
// `T` is the options as written: it picks the result type without taking part in the inference of
// `D`, which `head` reads from `load`. Written type arguments (`definePage<P, S, D, C>(…)`, the only
// way to type the context `C`) infer nothing, so `T` would stay at its default: the overloads of
// 1.2 that follow pick the mode and `load` for them. A call without written type arguments gets to
// the last signature, the first one again: while TypeScript skips `load` and `head` to infer `T`,
// the first one has `T` at its default and the 1.2 overloads `D` at theirs, and both reject the call
// before they type `load` and `head`, whose parameter types stay as the first signature that types
// them leaves them.
/**
 * Declara las opciones de ruta de una página y conserva la inferencia de tipos entre los schemas,
 * `load` y `head`. Se exporta como `route` (o por defecto) desde `<script server>` o un sidecar
 * `*.route.ts`, y `meeko check` compara sus datos con las props de la página. En el `<script>` del
 * componente no tiene efecto: da el aviso `MEEK109`.
 *
 * `render` decide el tipo de las opciones: sin él (`"ssr"` por defecto) o con `"stream"` o
 * `"prerender"` son {@link PageDefinition} y `load` recibe {@link PageLoadContext}; con `"client"`
 * son {@link ClientPageDefinition} y `load` recibe {@link ClientPageLoadContext}. Si declara
 * `load`, el resultado lo conserva como obligatorio, igual que los datos de la página.
 *
 * @typeParam P Schema de `params`, inferido de la opción.
 * @typeParam S Schema de `search`, inferido de la opción.
 * @typeParam D Datos que devuelve `load`.
 * @typeParam C Tipo del contexto de la petición en el loader de servidor.
 * @typeParam T Tipo de las opciones recibidas, que decide el modo y si hay `load`.
 * @param definition Opciones de ruta de la página.
 * @returns La misma definición, con el tipo de su modo de render.
 * @throws {TypeError} Si declara `render: "client"` junto con `prerenderEntries`.
 * @example
 * ```html
 * <!-- app/pages/users/[id].meeko -->
 * <script server lang="ts">
 * import * as v from "valibot";
 *
 * export const route = definePage({
 *   params: v.object({ id: v.string() }),
 *   load: async ({ params }) => ({ id: params.id }),
 *   head: ({ data }) => ({ title: data.id }),
 * });
 * </script>
 *
 * <script lang="ts">
 * export interface Props { params: { id: string }; search: Record<string, string | string[]>; data: { id: string } }
 * const props = defineProps<Props>();
 * </script>
 * <template><h1>{props.data.id}</h1></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#opciones-de-ruta-con-definepage
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
  const T extends WrittenOptions | TypeArgumentsNotWritten = TypeArgumentsNotWritten,
>(definition: T & AnyPageDefinition<P, S, D, C> & ExactLayoutProps<T>): DefinedPage<P, S, D, C, T>;
/**
 * `definePage<P, S, D>(…)` con argumentos de tipo explícitos y `render: "client"` con `load`: los datos
 * son obligatorios para la página.
 * @see {@link ClientPageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = TypeArgumentsNotWritten,
>(definition: NoInfer<WhenWritten<D, ClientPageDefinition<P, S, D> & { readonly load: NonNullable<ClientPageDefinition<P, S, D>["load"]> }>>): ClientPageDefinition<P, S, D> & { readonly load: NonNullable<ClientPageDefinition<P, S, D>["load"]> };
/**
 * `definePage<P, S, D>(…)` con argumentos de tipo explícitos y `render: "client"` sin `load`.
 * @see {@link ClientPageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = TypeArgumentsNotWritten,
>(definition: NoInfer<WhenWritten<D, ClientPageDefinition<P, S, D>>>): ClientPageDefinition<P, S, D>;
/**
 * `definePage<P, S, D, C>(…)` con argumentos de tipo explícitos, render en el servidor y `load`: los
 * datos son obligatorios para la página.
 * @see {@link PageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = TypeArgumentsNotWritten,
  C = unknown,
>(definition: NoInfer<WhenWritten<D, PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> }>>): PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> };
/**
 * `definePage<P, S, D, C>(…)` con argumentos de tipo explícitos y render en el servidor sin `load`.
 * @see {@link PageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = TypeArgumentsNotWritten,
  C = unknown,
>(definition: NoInfer<WhenWritten<D, PageDefinition<P, S, D, C>>>): PageDefinition<P, S, D, C>;
// The first signature again, last: it resolves the calls without written type arguments, and when
// no signature accepts a call TypeScript reports the error of the last one, that of these options.
/**
 * Declara las opciones de ruta de una página; véase la primera firma.
 * @see {@link PageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
  const T extends WrittenOptions = {},
>(definition: T & AnyPageDefinition<P, S, D, C> & ExactLayoutProps<T>): DefinedPage<P, S, D, C, T>;
export function definePage(definition: unknown): unknown {
  if (typeof definition === "object" && definition !== null && "render" in definition && definition.render === "client"
    && "prerenderEntries" in definition && definition.prerenderEntries !== undefined) {
    throw new TypeError('render: "client" cannot be prerendered; remove prerenderEntries or use render: "prerender"');
  }
  if (record(definition) && definition.cache !== undefined) {
    if (definition.render === "client") throw new TypeError('render: "client" has no server cache; remove cache or render the page on the server');
    // A wrong cache fails where the page is defined, not on its first cached request.
    resolvePageCache(definition.cache, "definePage");
  }
  return definition;
}

/**
 * Error de validación de `params` o `search` de una página contra sus schemas. El servidor responde
 * `400` con el código, y en el navegador se muestra la página de error con ese estado. Desde `1.7`,
 * su `name` es `"PageInputError"`, como el de `ClientError` y `ApiError`.
 *
 * @example
 * ```ts
 * import { PageInputError } from "@meekojs/meeko/framework";
 *
 * function statusOf(error: unknown): number {
 *   return error instanceof PageInputError ? 400 : 500;
 * }
 * ```
 */
export class PageInputError extends Error {
  /** @param code `INVALID_PARAMS` o `INVALID_SEARCH`, según la entrada que falló. */
  constructor(public readonly code: "INVALID_PARAMS" | "INVALID_SEARCH") {
    super(code);
    // Since 1.7, like `ClientError` and `ApiError`: logs and `error.name` say which error it is.
    this.name = "PageInputError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parse(schema: PageSchema | undefined, raw: Record<string, unknown>, code: PageInputError["code"]): Promise<Record<string, unknown>> {
  if (!schema) return raw;
  const result = await schema["~standard"].validate(raw);
  if ("issues" in result && result.issues) throw new PageInputError(code);
  const value = (result as { value: unknown }).value;
  if (!record(value)) throw new PageInputError(code);
  return value;
}

/** Validates both inputs before a page loader executes. */
export async function validatePageInputs(
  definition: Pick<PageDefinition<PageSchema | undefined, PageSchema | undefined, unknown>, "params" | "search"> | undefined,
  params: Readonly<Record<string, string>>,
  search: Readonly<Record<string, string | string[]>>,
): Promise<{ params: Readonly<Record<string, unknown>>; search: Readonly<Record<string, unknown>> }> {
  return {
    params: await parse(definition?.params, { ...params }, "INVALID_PARAMS"),
    search: await parse(definition?.search, { ...search }, "INVALID_SEARCH"),
  };
}

/** Preserves duplicate search keys for schema validation. */
export function pageSearchObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}
