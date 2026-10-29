import type { GeneratedRoutes } from "../framework.js";
import type { RequestContext } from "../framework-server/context.js";
import type { Deferred } from "./deferred.js";
import type { PageHead, PageSchema } from "./page.js";
import { mergeHeadInputs, providePageHeadSink } from "./head.js";
import type { HeadInput } from "./head.js";

/**
 * Petición para la que se ejecuta el código de nivel superior del `<script server>` de una página,
 * tal como la devuelve `usePage()`. `params` y `search` son la salida de los schemas de la ruta o,
 * sin schemas, los parámetros del ID de ruta.
 *
 * @typeParam P Parámetros de la ruta.
 * @typeParam S Parámetros de búsqueda.
 * @since 1.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * const { params, search, signal } = usePage();
 * const response = await fetch(`https://api.example.com/users/${params.id}`, { signal });
 * export const profile = { user: (await response.json()) as { name: string }, tab: search.tab ?? "info" };
 * </script>
 * ```
 */
export interface PageRequest<P = Readonly<Record<string, string>>, S = Readonly<Record<string, string | string[]>>> {
  /** URL de la petición. */
  readonly url: URL;
  /** Parámetros de la ruta. */
  readonly params: P;
  /** Parámetros de búsqueda. */
  readonly search: S;
  /** Petición HTTP original. */
  readonly request: Request;
  /**
   * Contexto de la petición de `createServerApp`: sesión, servicios y plataforma. Con
   * `createFrameworkHandler` sin `createContext`, leerlo lanza un error.
   */
  readonly context: RequestContext;
  /** Se aborta si el cliente se desconecta, se revoca la sesión o se cancela la respuesta. */
  readonly signal: AbortSignal;
}

type SchemaOutput<S> = S extends PageSchema<unknown, infer O> ? O : never;
type RouteSchema<Route, Key extends "params" | "search", Fallback> = [Route] extends [undefined] ? Fallback
  : Route extends { readonly [K in Key]?: infer S } ? [SchemaOutput<NonNullable<S>>] extends [never] ? Fallback : SchemaOutput<NonNullable<S>> : Fallback;
type IdParams<Id extends string> = Id extends keyof GeneratedRoutes ? GeneratedRoutes[Id] : Readonly<Record<string, string>>;

/**
 * Tipo de `usePage()` en una página cuyas opciones de ruta son `Route` y cuyo ID de ruta es `Id`:
 * toma `params` y `search` de los schemas de `Route` o, si no los declara, de las rutas generadas.
 * Lo usan las declaraciones que Meeko genera para el bloque `<script server>`.
 *
 * @typeParam Route Tipo de las opciones de ruta (`typeof route`), o `undefined`.
 * @typeParam Id ID de la ruta, como `"/users/[id]"`.
 * @since 1.1.0
 * @example
 * ```ts
 * import type { PageRequestOf } from "@meekojs/meeko/framework";
 *
 * // Con GeneratedRoutes instalado, params es { id: string }.
 * type UserPage = PageRequestOf<undefined, "/users/[id]">;
 * declare const page: UserPage;
 * const id: string = page.params.id;
 * ```
 */
export type PageRequestOf<Route, Id extends string = string> = PageRequest<
  RouteSchema<Route, "params", IdParams<Id>>,
  RouteSchema<Route, "search", Readonly<Record<string, string | string[]>>>
>;

/**
 * Tipo de `export const head` en el código de nivel superior de un `<script server>`: el head de la
 * página ({@link PageHead}: `title`, `description` y, desde `1.2`, las etiquetas de `useHead`), o una
 * función sin argumentos que lo devuelve. No llega al navegador como dato.
 *
 * @since 1.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * const { params } = usePage();
 * export const user = { id: params.id };
 * export const head = { title: `Usuario ${user.id}`, description: `Perfil del usuario ${user.id}` };
 * </script>
 * ```
 */
export type PageBodyHead = PageHead | (() => PageHead);

/**
 * Cómo ven el `<script>` y la plantilla de una página un export de su código de nivel superior de
 * servidor: el valor ya esperado, tal como llega en el payload y de sólo lectura en profundidad.
 *
 * @typeParam T Tipo del export en el bloque `<script server>`.
 * @since 1.1.0
 * @example
 * ```ts
 * import type { ServerData } from "@meekojs/meeko/framework";
 *
 * type User = ServerData<{ name: string; tags: string[] }>;
 * // { readonly name: string; readonly tags: { readonly [n: number]: string; ... } }
 * declare const user: User;
 * const first = user.tags[0];
 * ```
 */
export type ServerData<T> = T extends string | number | boolean | bigint | symbol | null | undefined ? T
  : T extends Deferred<infer U> ? Deferred<ServerData<U>>
  : T extends (...args: never[]) => unknown ? T
  : T extends object ? { readonly [K in keyof T]: ServerData<T[K]> }
  : T;

type NotJson = "not serializable to JSON: functions, undefined, bigint, symbols and class instances cannot reach the client";

/**
 * Forma serializable en JSON de `T`. Un miembro que no puede llegar al cliente (funciones,
 * `undefined`, `bigint`, símbolos o instancias de clase) se convierte en una cadena que lo explica,
 * de modo que el error de tipos señala el campo.
 *
 * @typeParam T Tipo que se va a enviar al cliente.
 * @since 1.1.0
 * @example
 * ```ts
 * import type { JsonShape } from "@meekojs/meeko/framework";
 *
 * type Shape = JsonShape<{ id: string; load: () => void }>;
 * // Shape["load"] es la cadena "not serializable to JSON: ...".
 * const ok: JsonShape<{ id: string }> = { id: "1" };
 * ```
 */
export type JsonShape<T> = T extends string | number | boolean | null ? T
  : T extends Deferred<infer U> ? Deferred<JsonShape<U>>
  : T extends undefined | bigint | symbol | ((...args: never[]) => unknown) ? NotJson
  : T extends readonly unknown[] ? { [K in keyof T]: JsonShape<T[K]> }
  : T extends object ? { [K in keyof T]: JsonShape<T[K]> }
  : NotJson;

/**
 * Comprobación de tipos que falla cuando un export del código de nivel superior de servidor no se
 * puede serializar en JSON. `Shape` es `JsonShape<T>`. El compilador la genera para cada export.
 *
 * @typeParam T Tipo del export.
 * @typeParam Shape Su forma JSON, `JsonShape<T>`.
 * @since 1.1.0
 * @example
 * ```ts
 * import type { JsonShape, SerializableExport } from "@meekojs/meeko/framework";
 *
 * type User = { id: string; joined: string };
 * type Checked = SerializableExport<User, JsonShape<User>>; // User
 * // SerializableExport<{ at: Date }, JsonShape<{ at: Date }>> no compila: Date es una clase.
 * ```
 */
export type SerializableExport<T extends Shape, Shape> = T;

/** Exports of a run of top-level server code; `head` stays on the server. */
export interface PageBodyResult {
  readonly data: Record<string, unknown>;
  readonly head?: unknown;
}

interface PageScope {
  run<T>(page: PageRequest<unknown, unknown>, body: () => T): T;
  current(): PageRequest<unknown, unknown> | undefined;
}

let scope: PageScope | undefined;

/** @internal The server handler binds `usePage()` to the request it is rendering. */
export function providePageScope(provider: PageScope): void {
  scope = provider;
}

/** `useHead` calls of each run of top-level server code. */
const bodyHeads = new WeakMap<PageRequest<unknown, unknown>, Array<() => HeadInput>>();

// useHead in top-level server code adds to the route head of the request being rendered.
providePageHeadSink((read) => {
  const page = scope?.current();
  if (!page) return false;
  const heads = bodyHeads.get(page);
  if (!heads) return false;
  heads.push(read);
  return true;
});

function outside(name: string): Error {
  return new Error(`MEEK073: ${name}() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`);
}

function activePage(name: string): PageRequest<unknown, unknown> {
  const page = scope?.current();
  if (!page) throw outside(name);
  return page;
}

/**
 * Devuelve la petición de la página cuyo código de nivel superior de `<script server>` se está
 * ejecutando. Dentro del bloque está disponible sin importarlo y su tipo sigue los schemas y el
 * ID de la ruta.
 *
 * @returns La {@link PageRequest} en curso.
 * @throws {Error} `MEEK073` si se llama fuera de ese código, por ejemplo en un `load`. En el `<script>`
 * o la plantilla del componente, `MEEK073` es un error de compilación.
 * @since 1.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * const { params, url } = usePage();
 * export const user = { id: params.id, path: url.pathname };
 * </script>
 *
 * <script lang="ts">
 * const label = signal(user.id);
 * </script>
 * <template><p>{user.path}: {label.value}</p></template>
 * ```
 */
export function usePage(): PageRequest {
  return activePage("usePage") as PageRequest;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

/**
 * Detiene el código de nivel superior de servidor de la página y responde con una redirección. Una
 * navegación de cliente la sigue igual que una redirección del loader.
 *
 * @param url Destino de la redirección.
 * @param status Estado HTTP; `302` por defecto.
 * @throws {Error} `MEEK073` fuera del código de nivel superior de un `<script server>`.
 * @throws {RangeError} Si `status` no es 301, 302, 303, 307 ni 308.
 * @since 1.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * const { context, url } = usePage();
 * if (!context.session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
 * export const account = { id: "me" };
 * </script>
 * ```
 */
export function redirect(url: string | URL, status: 301 | 302 | 303 | 307 | 308 = 302): never {
  activePage("redirect");
  if (!redirectStatuses.has(status)) throw new RangeError(`redirect status must be 301, 302, 303, 307 or 308, not ${String(status)}`);
  throw new Response(null, { status, headers: { location: String(url), "cache-control": "no-store" } });
}

/** Read by the server like `ApiError`: a 404 rendered with the nearest error page. */
class PageNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  readonly status = 404;
  constructor() {
    super("NOT_FOUND");
    this.name = "ApiError";
  }
}

/**
 * Detiene el código de nivel superior de servidor de la página y renderiza la página de error más
 * cercana con estado `404`.
 *
 * @throws {Error} `MEEK073` fuera del código de nivel superior de un `<script server>`.
 * @since 1.1.0
 * @example
 * ```html
 * <script server lang="ts">
 * import { findUser } from "../../../server/users.js";
 * const { params } = usePage();
 * const row = await findUser(params.id);
 * if (!row) notFound();
 * export const user = { id: row.id, name: row.name };
 * </script>
 * ```
 */
export function notFound(): never {
  activePage("notFound");
  throw new PageNotFoundError();
}

interface BodyContext {
  readonly request: Request;
  readonly params: unknown;
  readonly search: unknown;
  readonly signal: AbortSignal;
  readonly context?: RequestContext | undefined;
}

function thenable(value: unknown): value is PromiseLike<unknown> {
  return (typeof value === "object" || typeof value === "function") && value !== null && typeof (value as { then?: unknown }).then === "function";
}

/**
 * @internal Route options of a page with top-level `<script server>` code. The
 * generated `load` runs the code per request and returns its exports; `head`
 * comes from `export const head` or else from the options.
 */
export function definePageBody(options: Record<string, unknown> | undefined, body: () => Promise<PageBodyResult>, exportsHead: boolean): Record<string, unknown> {
  if (options?.load !== undefined) throw new TypeError("MEEK070: un <script server> con código de nivel superior no puede declarar también route.load; deja sólo uno de los dos");
  if (options?.render === "client") throw new TypeError('MEEK074: una página render: "client" no puede tener código de servidor de nivel superior; su <script server> se ejecuta en el navegador');
  if (exportsHead && options?.head !== undefined) throw new TypeError("MEEK072: <script server> exporta head y además declara route.head; deja sólo uno de los dos");
  const heads = new WeakMap<object, { readonly exported: unknown; readonly used: ReadonlyArray<() => HeadInput> }>();
  const load = async (context: BodyContext): Promise<Record<string, unknown>> => {
    const page: PageRequest<unknown, unknown> = {
      url: new URL(context.request.url), params: context.params, search: context.search, request: context.request, signal: context.signal,
      get context(): RequestContext {
        if (!context.context) throw new Error("usePage().context needs a request context; createServerApp provides it, createFrameworkHandler needs createContext");
        return context.context;
      },
    };
    const used: Array<() => HeadInput> = [];
    bodyHeads.set(page, used);
    const run = (): Promise<PageBodyResult> => body();
    const result = await (scope ? scope.run(page, run) : run());
    // An exported promise arrives awaited; a `defer` value is sent later by the stream.
    const entries = await Promise.all(Object.entries(result.data).map(async ([key, value]) => [key, thenable(value) ? await value : value] as const));
    const data: Record<string, unknown> = Object.fromEntries(entries);
    heads.set(data, { exported: exportsHead ? result.head : undefined, used });
    return data;
  };
  const optionsHead = options?.head as ((context: unknown) => PageHead) | undefined;
  // useHead calls come first; `export const head` or `route.head` wins over them.
  const head = (context: { readonly data: unknown }): PageHead => {
    const stored = typeof context.data === "object" && context.data !== null ? heads.get(context.data) : undefined;
    const value = stored?.exported;
    const declared = exportsHead
      ? typeof value === "function" ? (value as () => PageHead)() : value as PageHead | undefined
      : optionsHead?.(context);
    if (!stored?.used.length) return declared ?? {};
    const merged = mergeHeadInputs([...stored.used.map((read) => read()), declared]) as PageHead;
    return declared?.description === undefined ? merged : { ...merged, description: declared.description };
  };
  return { ...options, load, head };
}

/** @internal The exports of the page's top-level server code, as the compiled page reads them. */
export function pageData(props: unknown): Record<string, unknown> {
  const data = typeof props === "object" && props !== null ? (props as { readonly data?: unknown }).data : undefined;
  if (typeof data !== "object" || data === null) {
    throw new Error("This page reads the exports of its <script server>, but it was rendered without route data; render pages through the Meeko router");
  }
  return data as Record<string, unknown>;
}
