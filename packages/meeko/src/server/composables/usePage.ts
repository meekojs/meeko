import type { GeneratedRoutes } from "../../framework";
import type { RequestContext } from "../runtime/request-context";
import type { PageSchema } from "../../app/definitions/define-page";

/**
 * PeticiÃ³n para la que se ejecuta el cÃ³digo de nivel superior del `<script server>` de una pÃ¡gina,
 * tal como la devuelve `usePage()`. `params` y `search` son la salida de los schemas de la ruta o,
 * sin schemas, los parÃ¡metros del ID de ruta.
 *
 * @typeParam P ParÃ¡metros de la ruta.
 * @typeParam S ParÃ¡metros de bÃºsqueda.
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
  /** URL de la peticiÃ³n. */
  readonly url: URL;
  /** ParÃ¡metros de la ruta. */
  readonly params: P;
  /** ParÃ¡metros de bÃºsqueda. */
  readonly search: S;
  /** PeticiÃ³n HTTP original. */
  readonly request: Request;
  /**
   * Contexto de la peticiÃ³n de `createServerApp`: sesiÃ³n, servicios y plataforma. Con
   * `createFrameworkHandler` sin `createContext`, leerlo lanza un error.
   */
  readonly context: RequestContext;
  /** Se aborta si el cliente se desconecta, se revoca la sesiÃ³n o se cancela la respuesta. */
  readonly signal: AbortSignal;
}

type SchemaOutput<S> = S extends PageSchema<unknown, infer O> ? O : never;
type RouteSchema<Route, Key extends "params" | "search", Fallback> = [Route] extends [undefined] ? Fallback
  : Route extends { readonly [K in Key]?: infer S } ? [SchemaOutput<NonNullable<S>>] extends [never] ? Fallback : SchemaOutput<NonNullable<S>> : Fallback;
type IdParams<Id extends string> = Id extends keyof GeneratedRoutes ? GeneratedRoutes[Id] : Readonly<Record<string, string>>;

/**
 * Tipo de `usePage()` en una pÃ¡gina cuyas opciones de ruta son `Route` y cuyo ID de ruta es `Id`:
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

interface PageScope {
  run<T>(page: PageRequest<unknown, unknown>, body: () => T): T;
  current(): PageRequest<unknown, unknown> | undefined;
}

let scope: PageScope | undefined;

/** @internal Bind `usePage()` to the active request. */
export function providePageScope(provider: PageScope): void {
  scope = provider;
}

/** @internal Read the request without requiring one. */
export function currentPage(): PageRequest<unknown, unknown> | undefined {
  return scope?.current();
}

/** @internal Run compiled page code with its request scope. */
export function runPage<T>(page: PageRequest<unknown, unknown>, body: () => T): T {
  return scope ? scope.run(page, body) : body();
}

/** @internal Read the request or throw the existing server-script scope diagnostic. */
export function activePage(name: string): PageRequest<unknown, unknown> {
  const page = currentPage();
  if (!page) throw new Error(`MEEK073: ${name}() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`);
  return page;
}

/**
 * Devuelve la peticiÃ³n de la pÃ¡gina cuyo cÃ³digo de nivel superior de `<script server>` se estÃ¡
 * ejecutando. Dentro del bloque estÃ¡ disponible sin importarlo y su tipo sigue los schemas y el
 * ID de la ruta.
 *
 * @returns La {@link PageRequest} en curso.
 * @throws {Error} `MEEK073` si se llama fuera de ese cÃ³digo, por ejemplo en un `load`. En el `<script>`
 * o la plantilla del componente, `MEEK073` es un error de compilaciÃ³n.
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
