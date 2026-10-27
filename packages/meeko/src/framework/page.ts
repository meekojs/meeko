import type { StateStore } from "./state.js";
import { normalizeHeadInput } from "./head.js";
import type { HeadInput } from "./head.js";

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
 * Opciones de ruta de una página que se renderiza en el servidor (`"ssr"`, `"stream"` o
 * `"prerender"`). Se declaran con {@link definePage} en `<script server>` o en un sidecar `*.route.ts`.
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
 */
export interface PageDefinition<P extends PageSchema | undefined, S extends PageSchema | undefined, D, C = unknown> {
  /** Schema de los parámetros de la ruta; una entrada inválida responde `400`. */
  readonly params?: P;
  /** Schema de los parámetros de búsqueda; una entrada inválida responde `400`. */
  readonly search?: S;
  /** Modo de render; debe ser un literal que `meeko build` pueda leer sin ejecutar el archivo. */
  readonly render?: Exclude<PageRender, "client">;
  /** Parámetros de cada URL que se prerenderiza en una ruta dinámica `"prerender"`. */
  readonly prerenderEntries?: readonly Readonly<Record<string, string>>[] | (() => Promise<readonly Readonly<Record<string, string>>[]>);
  /** Loader del servidor; puede devolver un `Response` para redirigir y valores `defer`. */
  readonly load?: (args: PageLoadContext<P, S, C>) => Promise<D> | D;
  /** Calcula el `title` y la `description` con los datos del loader. */
  readonly head?: (args: PageLoadContext<P, S, C> & { data: D }) => PageHead;
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
  /** Schema de los parámetros de la ruta. */
  readonly params?: P;
  /** Schema de los parámetros de búsqueda. */
  readonly search?: S;
  /** Modo de render. */
  readonly render: "client";
  /** Una página `"client"` no se puede prerenderizar. */
  readonly prerenderEntries?: never;
  /** Loader del navegador. */
  readonly load?: (args: ClientPageLoadContext<P, S>) => Promise<D> | D;
  /** Se ejecuta en el navegador después de `load`; su título y su descripción se aplican al confirmar la página. */
  readonly head?: (args: ClientPageLoadContext<P, S> & { data: D }) => PageHead;
}

/**
 * Declara las opciones de ruta de una página y conserva la inferencia de tipos entre los schemas,
 * `load` y `head`. Se exporta como `route` (o por defecto) desde `<script server>` o un sidecar
 * `*.route.ts`, y `meeko check` compara sus datos con las props de la página.
 *
 * @param definition Opciones de ruta de la página.
 * @returns La misma definición.
 * @throws {TypeError} Si declara `render: "client"` junto con `prerenderEntries`.
 * @example
 * ```html
 * <!-- app/pages/users/[id].meeko -->
 * <script server lang="ts">
 * import { definePage } from "@meekojs/meeko/framework";
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
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#routing-layouts-y-ssr
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
>(definition: ClientPageDefinition<P, S, D> & { readonly load: NonNullable<ClientPageDefinition<P, S, D>["load"]> }): ClientPageDefinition<P, S, D> & { readonly load: NonNullable<ClientPageDefinition<P, S, D>["load"]> };
/**
 * Declara las opciones de una página `render: "client"` sin `load`.
 * @see {@link ClientPageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
>(definition: ClientPageDefinition<P, S, D>): ClientPageDefinition<P, S, D>;
/**
 * Declara las opciones de una página renderizada en el servidor con `load`; sus datos son obligatorios
 * para la página.
 * @see {@link PageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
>(definition: PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> }): PageDefinition<P, S, D, C> & { readonly load: NonNullable<PageDefinition<P, S, D, C>["load"]> };
/**
 * Declara las opciones de una página renderizada en el servidor (`"ssr"`, `"stream"` o `"prerender"`).
 * @see {@link PageDefinition}
 */
export function definePage<
  const P extends PageSchema | undefined = undefined,
  const S extends PageSchema | undefined = undefined,
  D = unknown,
  C = unknown,
>(definition: PageDefinition<P, S, D, C>): PageDefinition<P, S, D, C>;
export function definePage(definition: unknown): unknown {
  if (typeof definition === "object" && definition !== null && "render" in definition && definition.render === "client"
    && "prerenderEntries" in definition && definition.prerenderEntries !== undefined) {
    throw new TypeError('render: "client" cannot be prerendered; remove prerenderEntries or use render: "prerender"');
  }
  return definition;
}

/**
 * Error de validación de `params` o `search` de una página contra sus schemas. El servidor responde
 * `400` con el código, y en el navegador se muestra la página de error con ese estado.
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
