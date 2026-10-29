/**
 * Data composables for component scripts: `useApi`, `useRpcQuery`, `useRpcMutation` and
 * `useApiMutation`.
 *
 * `useApi` and `useRpcQuery` return reactive `{ data, error, pending, refresh }`. Awaited at the
 * top level of a script, the framework loads the data before the page renders (SSR, hydration
 * and client navigation) through a `ResourceScope`; without `await`, the request runs in the
 * browser once the component mounts. After mounting, a change of a signal in the input loads
 * the data again.
 */
import { setupPhase, whenMounted } from "../lifecycle.js";
import { batch, createContext, effect, findContext, isSignal, onCleanup, provide, signal, untrack } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";
import { awaitSync, canSuspendLate, provideDeferredData, suspend, suspendLate } from "../suspense.js";
import { requestApi, requestRpc } from "./clients.js";
import type { AnyApiOperation, ApiMutationArguments, ApiMutationInput, ApiRequestInput, ClientOptions, PublicServerManifest, RpcOperation } from "./clients.js";
import { createMutation } from "./mutations.js";
import type { MutationOptions, RetrySafeMutation, RetrySafeOptions } from "./mutations.js";

/**
 * Datos reactivos que devuelven `useApi` y `useRpcQuery`. Sin `await`, `data` vale `null` hasta la
 * primera carga, que empieza en el navegador al montar el componente. Con `await` en el nivel
 * superior del script se obtiene un {@link LoadedResource}.
 *
 * @typeParam T Salida del endpoint o del procedimiento.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const users = useApi("/api/users");
 * </script>
 * <template>
 *   <p if:when="users.pending.value">Cargando…</p>
 *   <p if:when="users.error.value">No se pudieron cargar los usuarios.</p>
 *   <ul><li each:of="users.data.value ?? []" each:as="user" each:key="user.id">{user.name}</li></ul>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation
 */
export interface DataResource<T> extends PromiseLike<LoadedResource<T>> {
  /**
   * Datos de la última carga correcta, o `null` antes de la primera. Una recarga (`refresh()` o un
   * cambio de la entrada) los conserva hasta que llegan los nuevos; desde `1.5`, con
   * `keepPrevious: false`, un cambio de la entrada los vacía.
   */
  readonly data: ReadonlySignal<T | null>;
  /** Fallo de la última carga, o `null`. */
  readonly error: ReadonlySignal<Error | null>;
  /** `true` mientras hay una carga en curso. */
  readonly pending: ReadonlySignal<boolean>;
  /**
   * `true` mientras hay una recarga en curso y `data` conserva los datos de una carga anterior: la
   * primera carga es `pending` sin `refreshing`. Sirve para un indicador discreto que no oculta los
   * datos (desde `1.5`).
   */
  readonly refreshing: ReadonlySignal<boolean>;
  /** Vuelve a pedir los datos con la entrada actual; un fallo sólo actualiza `error`. */
  refresh(): Promise<void>;
}

/**
 * Recurso esperado con `await`: sus datos ya se cargaron, así que `data` nunca es `null`. En SSR el
 * servidor renderiza hasta tenerlos y los envía en el payload; la hidratación no repite la petición.
 *
 * @typeParam T Salida del endpoint o del procedimiento.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
 * const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
 * </script>
 * <template><h1>{user.data.value.name}</h1></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#con-y-sin-await
 */
export interface LoadedResource<T> {
  /** Datos cargados; se actualizan al recargar. */
  readonly data: ReadonlySignal<T>;
  /** Fallo de la última recarga, o `null`. */
  readonly error: ReadonlySignal<Error | null>;
  /** `true` mientras hay una recarga en curso. */
  readonly pending: ReadonlySignal<boolean>;
  /** `true` mientras hay una recarga en curso; `data` conserva los datos anteriores (desde `1.5`). */
  readonly refreshing: ReadonlySignal<boolean>;
  /** Vuelve a pedir los datos con la entrada actual; un fallo sólo actualiza `error`. */
  refresh(): Promise<void>;
}

/**
 * Opciones de recarga de `useApi` y `useRpcQuery`: su último argumento, después de las opciones de
 * la petición o de la entrada.
 *
 * @since 1.5.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
 * // Al cambiar de usuario, data vuelve a null en lugar de mostrar el anterior mientras carga.
 * const user = useApi("/api/users/[id]", () => ({ params: { id: props.params.id } }), { keepPrevious: false });
 * // Por defecto, data conserva la página anterior mientras llega la siguiente.
 * const page = signal("1");
 * const list = useApi("/api/users", { query: { page } });
 * // Desde 1.7: una petición cuando se deja de escribir, y ninguna con menos de dos letras.
 * const q = signal("");
 * const hits = useRpcQuery("docs.search", () => ({ q: q.value }), { debounceMs: 200, enabled: () => q.value.length >= 2 });
 * </script>
 * <template><p if:when="list.refreshing.value">Actualizando…</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#datos-anteriores-durante-una-recarga-keepprevious
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#búsqueda-mientras-se-escribe-debouncems-y-enabled
 */
export interface DataResourceOptions {
  /**
   * Si `data` conserva el valor anterior cuando cambia la entrada (sus señales) mientras llegan los
   * datos nuevos, con `pending` y `refreshing` en `true`. Por defecto `true`, como hasta `1.4`.
   * Con `false`, un cambio de la entrada vacía `data` y `error` y vuelve a ser una primera carga
   * (`pending` sin `refreshing`). `refresh()` conserva siempre los datos, y un recurso esperado con
   * `await`, cuyo `data` nunca es `null`, también.
   */
  readonly keepPrevious?: boolean;
  /**
   * Milisegundos que la entrada debe quedarse quieta antes de pedir los datos (desde `1.7`), como en
   * una búsqueda mientras se escribe: una ráfaga de cambios hace una sola petición, con la última
   * entrada. Cada cambio cancela la petición en curso. Durante la espera `pending` vale `true` y
   * `data` conserva el resultado anterior, salvo con `keepPrevious: false`. No retrasa la primera
   * carga, `refresh()` ni el SSR, que pide los datos de un `await` enseguida para hidratar.
   * @since 1.7.0
   */
  readonly debounceMs?: number;
  /**
   * Si se piden los datos (desde `1.7`): un booleano, una señal o una función que lee señales, como
   * `() => query.value.length >= 2`. Mientras vale `false` no hay petición (tampoco con
   * `refresh()`), la que estaba en curso se cancela, `pending` vale `false` y `data` conserva el
   * último resultado, o `null` si no lo hubo. Al volver a `true` se piden los datos de la entrada
   * actual, salvo que `data` ya sea de esa entrada. Un recurso con `await` no puede empezar
   * desactivado.
   * @since 1.7.0
   */
  readonly enabled?: boolean | ReadonlySignal<boolean> | (() => boolean);
}

/**
 * Resultado de `useRpcMutation(procedimiento)`: llama al procedimiento bajo demanda con `mutate`,
 * nunca en SSR, y refleja la última llamada en `pending`, `data` y `error`. Con la opción
 * `retrySafe` añade {@link RetrySafeMutation} (desde `1.2`).
 *
 * @typeParam Input Entrada del procedimiento.
 * @typeParam Output Salida del procedimiento.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const rename = useRpcMutation("users.rename");
 * async function save(): Promise<void> {
 *   await rename.mutate({ id: "1", name: "Ada" });
 * }
 * </script>
 * <template><button bind:disabled="rename.pending.value" on:click="save">Guardar</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export interface RpcMutation<Input, Output> {
  /** Llama al procedimiento con el token CSRF; devuelve su salida o rechaza con su error. */
  mutate(input: Input): Promise<Output>;
  /** `true` mientras una llamada está en curso. */
  readonly pending: ReadonlySignal<boolean>;
  /** Fallo de la última llamada, o `null`. */
  readonly error: ReadonlySignal<Error | null>;
  /** Salida de la última llamada correcta, o `null`. */
  readonly data: ReadonlySignal<Output | null>;
}

/**
 * Resultado de `useApiMutation(ruta, método)`: llama a un endpoint de API que no es `GET` bajo
 * demanda con `mutate({ params, query, body })`, nunca en SSR, y refleja la última llamada en
 * `pending`, `data` y `error`. Con la opción `retrySafe` añade {@link RetrySafeMutation}.
 *
 * @typeParam O Operación del contrato de API.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const remove = useApiMutation("/api/notes/[id]", "DELETE");
 * async function erase(id: string): Promise<void> {
 *   await remove.mutate({ params: { id } });
 * }
 * </script>
 * <template><p if:when="remove.error.value">No se pudo borrar.</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export interface ApiMutation<O extends AnyApiOperation> {
  /**
   * Llama al endpoint con el token CSRF; devuelve su salida o rechaza con su error. Se puede
   * llamar sin argumentos cuando la operación no exige `params`, `query` ni `body`.
   */
  mutate(...input: ApiMutationArguments<O>): Promise<O["output"]>;
  /** `true` mientras una llamada está en curso. */
  readonly pending: ReadonlySignal<boolean>;
  /** Fallo de la última llamada, o `null`. */
  readonly error: ReadonlySignal<Error | null>;
  /** Salida de la última llamada correcta, o `null`. */
  readonly data: ReadonlySignal<O["output"] | null>;
}

/**
 * Un valor o una señal de ese valor. En la entrada de `useApi` y `useRpcQuery`, una señal hace que
 * la petición se repita cuando cambia.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { signal } from "@meekojs/meeko";
 * import type { Reactive } from "@meekojs/meeko/framework";
 *
 * const tab = signal("profile");
 * const fixed: Reactive<string> = "profile";
 * const tracked: Reactive<string> = tab;
 * ```
 */
export type Reactive<T> = T | ReadonlySignal<T>;
type ReactiveFields<T> = T extends readonly unknown[] ? T : T extends object ? { readonly [K in keyof T]: Reactive<T[K]> } : T;

type ParamsOption<P> = [P] extends [undefined] ? { readonly params?: never } : { readonly params: Reactive<ReactiveFields<P>> };
/** A query whose fields are all optional (it accepts `{}`) may be left out. */
type QueryOption<Q> = [Q] extends [undefined] ? { readonly query?: never }
  : {} extends Q ? { readonly query?: Reactive<ReactiveFields<Q>> } : { readonly query: Reactive<ReactiveFields<Q>> };
/**
 * Opciones de `useApi` para una operación GET: `params` y `query`, cuyos campos pueden ser señales.
 * `params` es obligatorio en las rutas dinámicas y `query`, cuando el contrato exige algún campo.
 * `useApi` acepta también una función que devuelve estas opciones leyendo señales.
 *
 * @typeParam O Operación GET del contrato de API.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const page = signal("1");
 * // Cada cambio de page vuelve a pedir la lista.
 * const users = useApi("/api/users", { query: { page } });
 * // Equivale a una función que lee las señales:
 * const same = useApi("/api/users", () => ({ query: { page: page.value } }));
 * </script>
 * ```
 */
export type ApiQueryOptions<O extends AnyApiOperation> = ParamsOption<O["params"]> & QueryOption<O["query"]>;
type ApiQueryInput<O extends AnyApiOperation> = ApiQueryOptions<O> | (() => ApiQueryOptions<O>);
type ApiQueryArguments<O extends AnyApiOperation> = [O["params"]] extends [undefined]
  ? [O["query"]] extends [undefined] ? [options?: ApiQueryInput<O>, resource?: DataResourceOptions]
    : {} extends O["query"] ? [options?: ApiQueryInput<O>, resource?: DataResourceOptions] : [options: ApiQueryInput<O>, resource?: DataResourceOptions]
  : [options: ApiQueryInput<O>, resource?: DataResourceOptions];
type RpcQueryInput<I> = Reactive<ReactiveFields<I>> | (() => I);
/** An input that accepts `{}` may be left out; the request then sends `{}`. */
type RpcQueryArguments<I> = {} extends I ? [input?: RpcQueryInput<I>, resource?: DataResourceOptions] : [input: RpcQueryInput<I>, resource?: DataResourceOptions];

type GetEndpoint<M> = M extends { readonly api: readonly (infer E)[] }
  ? Extract<E, { readonly method: "GET"; readonly pathname: string; readonly clientKey: string }>
  : never;
type GetOperation<C, K> = K extends keyof C ? C[K] extends { readonly get: infer O extends AnyApiOperation } ? O : never : never;

/**
 * Operaciones GET de un contrato de API indexadas por ruta (`"/api/users/[id]"`), a partir del
 * manifiesto público de la aplicación. Es el tipo que recibe {@link UseApi}.
 *
 * @typeParam Manifest Manifiesto público con los endpoints (`pathname`, `method`, `clientKey`).
 * @typeParam Contract Contrato `ApiContract` generado, indexado por `clientKey`.
 * @since 1.1.0
 * @example
 * ```ts
 * import type { ApiQueryContract } from "@meekojs/meeko/framework";
 *
 * type Contract = { users: { get: { params: undefined; query: undefined; output: string[] } } };
 * declare const manifest: { readonly api: readonly [{ readonly clientKey: "users"; readonly pathname: "/api/users"; readonly method: "GET" }] };
 * // Queries["/api/users"] es la operación GET de api.users.
 * type Queries = ApiQueryContract<typeof manifest, Contract>;
 * ```
 */
export type ApiQueryContract<Manifest, Contract> = {
  [E in GetEndpoint<Manifest> as E["pathname"]]: GetOperation<Contract, E["clientKey"]>;
};

type QueryOf<Queries, Path extends keyof Queries> = Extract<Queries[Path], AnyApiOperation>;
/**
 * Firma de `useApi(ruta, opciones?, recarga?)`: lee un endpoint GET por su ruta y devuelve un
 * {@link DataResource}. Sólo se llama en el nivel superior del `<script>` (`MEEK054`); con `await`,
 * la página no se renderiza hasta tener los datos. Desde `1.5`, el tercer argumento son las
 * {@link DataResourceOptions} (`keepPrevious` y, desde `1.7`, `debounceMs` y `enabled`).
 *
 * @typeParam Queries Operaciones GET por ruta, normalmente un {@link ApiQueryContract}.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const props = defineProps<{ params: { id: string }; search: Record<string, string | string[]> }>();
 * const user = await useApi("/api/users/[id]", { params: { id: props.params.id } });
 * </script>
 * <template><h1>{user.data.value.name}</h1></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation
 */
export type UseApi<Queries> =
  <Path extends keyof Queries & string>(path: Path, ...options: ApiQueryArguments<QueryOf<Queries, Path>>) => DataResource<QueryOf<Queries, Path>["output"]>;
/**
 * Firma de `useRpcQuery(procedimiento, input?, recarga?)`: lee datos mediante un procedimiento RPC y
 * devuelve un {@link DataResource}. `input` puede contener señales o ser una función que las lee; un
 * cambio vuelve a pedir los datos. Sólo en el nivel superior del `<script>` (`MEEK054`). Desde `1.5`,
 * el tercer argumento son las {@link DataResourceOptions} (`keepPrevious` y, desde `1.7`, `debounceMs` y `enabled`).
 *
 * @typeParam Contract Contrato `RpcContract` generado, indexado por ID de procedimiento.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const tab = signal("profile");
 * const activity = await useRpcQuery("users.activity", () => ({ id: "1", tab: tab.value }));
 * </script>
 * <template><p>{activity.data.value.length} eventos</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation
 */
export type UseRpcQuery<Contract extends Record<string, RpcOperation>> =
  <Procedure extends keyof Contract & string>(procedure: Procedure, ...input: RpcQueryArguments<Contract[Procedure]["input"]>) => DataResource<Contract[Procedure]["output"]>;
/**
 * Firma de `useRpcMutation(procedimiento, opciones?)`: devuelve una {@link RpcMutation} que llama
 * al procedimiento con `mutate(input)`. Con `{ retrySafe: { key } }` (desde `1.2`) devuelve además
 * {@link RetrySafeMutation}; `onSuccess` y `onError` (desde `1.2`) avisan de cada intento, también
 * de los reintentos automáticos. No admite `await` en el nivel superior (`MEEK055`).
 *
 * @typeParam Contract Contrato `RpcContract` generado, indexado por ID de procedimiento.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * const rename = useRpcMutation("users.rename");
 * async function save(name: string): Promise<void> {
 *   await rename.mutate({ id: "1", name });
 * }
 * const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export type UseRpcMutation<Contract extends Record<string, RpcOperation>> = {
  <Procedure extends keyof Contract & string>(procedure: Procedure, options?: MutationOptions<Contract[Procedure]["input"], Contract[Procedure]["output"]> & { readonly retrySafe?: undefined }): RpcMutation<Contract[Procedure]["input"], Contract[Procedure]["output"]>;
  <Procedure extends keyof Contract & string>(procedure: Procedure, options: MutationOptions<Contract[Procedure]["input"], Contract[Procedure]["output"]> & { readonly retrySafe: RetrySafeOptions }): RpcMutation<Contract[Procedure]["input"], Contract[Procedure]["output"]>
    & RetrySafeMutation<Contract[Procedure]["input"], Contract[Procedure]["output"]>;
};

type MutationEndpoint<M> = M extends { readonly api: readonly (infer E)[] }
  ? Extract<E, { readonly method: "POST" | "PUT" | "PATCH" | "DELETE"; readonly pathname: string; readonly clientKey: string }>
  : never;
type MethodOperation<C, K, M extends string> = K extends keyof C ? Lowercase<M> extends keyof C[K] ? Extract<C[K][Lowercase<M>], AnyApiOperation> : never : never;

/**
 * Operaciones de escritura (`POST`, `PUT`, `PATCH`, `DELETE`) de un contrato de API indexadas por
 * ruta y método (`["/api/notes"]["POST"]`), a partir del manifiesto público. Es el tipo que recibe
 * {@link UseApiMutation}.
 *
 * @typeParam Manifest Manifiesto público con los endpoints (`pathname`, `method`, `clientKey`).
 * @typeParam Contract Contrato `ApiContract` generado, indexado por `clientKey`.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ApiMutationContract, ApiOperation } from "@meekojs/meeko/framework";
 *
 * type Contract = { notes: { post: ApiOperation<undefined, undefined, { text: string }, { id: string }> } };
 * declare const manifest: { readonly api: readonly [{ readonly clientKey: "notes"; readonly pathname: "/api/notes"; readonly method: "POST" }] };
 * // Mutations["/api/notes"]["POST"] es la operación de api.notes.post.
 * type Mutations = ApiMutationContract<typeof manifest, Contract>;
 * ```
 */
export type ApiMutationContract<Manifest, Contract> = {
  [P in MutationEndpoint<Manifest>["pathname"]]: {
    [E in Extract<MutationEndpoint<Manifest>, { readonly pathname: P }> as E["method"]]: MethodOperation<Contract, E["clientKey"], E["method"]>;
  };
};

type MutationOf<Mutations, Path extends keyof Mutations, Method extends keyof Mutations[Path]> = Extract<Mutations[Path][Method], AnyApiOperation>;
/**
 * Firma de `useApiMutation(ruta, método, opciones?)`: devuelve una {@link ApiMutation} que llama
 * a un endpoint `POST`, `PUT`, `PATCH` o `DELETE` con `mutate({ params, query, body })`. Con
 * `{ retrySafe: { key } }` devuelve además {@link RetrySafeMutation}; `onSuccess` y `onError` avisan
 * de cada intento. Se llama mientras se ejecuta el script de un componente, normalmente en su nivel
 * superior, y no admite `await` (`MEEK055`).
 *
 * @typeParam Mutations Operaciones por ruta y método, normalmente un {@link ApiMutationContract}.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const create = useApiMutation("/api/notes", "POST");
 * const sale = useApiMutation("/api/sales", "POST", { retrySafe: { key: "pos:sale" } });
 * async function add(text: string): Promise<void> {
 *   await create.mutate({ body: { text } });
 * }
 * </script>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export type UseApiMutation<Mutations> = {
  <Path extends keyof Mutations & string, Method extends keyof Mutations[Path] & string>(path: Path, method: Method, options?: MutationOptions<ApiMutationInput<MutationOf<Mutations, Path, Method>>, MutationOf<Mutations, Path, Method>["output"]> & { readonly retrySafe?: undefined }): ApiMutation<MutationOf<Mutations, Path, Method>>;
  <Path extends keyof Mutations & string, Method extends keyof Mutations[Path] & string>(path: Path, method: Method, options: MutationOptions<ApiMutationInput<MutationOf<Mutations, Path, Method>>, MutationOf<Mutations, Path, Method>["output"]> & { readonly retrySafe: RetrySafeOptions }): ApiMutation<MutationOf<Mutations, Path, Method>>
    & RetrySafeMutation<ApiMutationInput<MutationOf<Mutations, Path, Method>>, MutationOf<Mutations, Path, Method>["output"]>;
};

type ScopeEntry =
  | { readonly status: "pending"; readonly promise: Promise<void> }
  | { readonly status: "resolved"; readonly value: unknown }
  | { readonly status: "rejected"; readonly error: unknown };

/**
 * Data of one page render, by request key. `"collect"` starts a missing request and suspends the
 * render (SSR and the browser before a navigation commits); `"read"` only reads loaded data
 * (hydration and the commit), and a missing key is an error.
 */
export class ResourceScope {
  readonly #entries = new Map<string, ScopeEntry>();
  readonly #used = new Set<string>();

  constructor(readonly mode: "collect" | "read", initial: Readonly<Record<string, unknown>> = {}, readonly signal?: AbortSignal) {
    for (const [key, value] of Object.entries(initial)) this.#entries.set(key, { status: "resolved", value });
  }

  entry(key: string): ScopeEntry | undefined {
    return this.#entries.get(key);
  }

  /** Starts `key` once; the entry settles with its result. */
  load(key: string, start: (signal: AbortSignal | undefined) => Promise<unknown>): Promise<void> {
    const existing = this.#entries.get(key);
    if (existing?.status === "pending") return existing.promise;
    const promise = Promise.resolve().then(() => start(this.signal)).then(
      (value) => { this.#entries.set(key, { status: "resolved", value }); },
      (error: unknown) => { this.#entries.set(key, { status: "rejected", error }); },
    );
    this.#entries.set(key, { status: "pending", promise });
    return promise;
  }

  markUsed(key: string): void {
    this.#used.add(key);
  }

  /** Forgets which keys a discarded render pass read. */
  beginPass(): void {
    this.#used.clear();
  }

  /** Loaded data that the last pass read, for the hydration payload. */
  usedData(): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of this.#used) {
      const entry = this.#entries.get(key);
      if (entry?.status === "resolved") result[key] = entry.value;
    }
    return result;
  }

  /** Every loaded value, to keep in the browser application's cache. */
  loadedData(): Map<string, unknown> {
    const result = new Map<string, unknown>();
    for (const [key, entry] of this.#entries) if (entry.status === "resolved") result.set(key, entry.value);
    return result;
  }
}

let activeScope: ResourceScope | undefined;

/** Runs a synchronous render, hydration or commit with `scope` as its data. */
export function withResourceScope<T>(scope: ResourceScope, work: () => T): T {
  const previous = activeScope;
  activeScope = scope;
  try { return work(); }
  finally { activeScope = previous; }
}

/**
 * Latest data of a browser application by request key. Components that mount after the page
 * committed, such as a region an `if:` shows, read an awaited resource from it.
 */
export class ResourceCache {
  readonly #values = new Map<string, unknown>();
  constructor(private readonly limit = 200) {}

  has(key: string): boolean { return this.#values.has(key); }
  get(key: string): unknown { return this.#values.get(key); }

  set(key: string, value: unknown): void {
    this.#values.delete(key);
    this.#values.set(key, value);
    while (this.#values.size > this.limit) this.#values.delete(this.#values.keys().next().value!);
  }

  merge(values: ReadonlyMap<string, unknown>): void {
    for (const [key, value] of values) this.set(key, value);
  }
}

const cacheKey = createContext<ResourceCache>("Meeko resources");

/** Makes an application's resource cache available to its component tree. */
export function provideResourceCache(cache: ResourceCache): void {
  provide(cacheKey, cache);
}

/**
 * A component that mounts after its page loads its awaited data in passes of its own, with the
 * application's cache, and keeps the result there.
 */
provideDeferredData((signal) => {
  const cache = findContext(cacheKey);
  const scope = new ResourceScope("collect", {}, signal);
  let loaded: ResourceScope | undefined;
  return {
    collect: (work) => { scope.beginPass(); return withResourceScope(scope, work); },
    read: (work) => withResourceScope(loaded ??= new ResourceScope("read", Object.fromEntries(scope.loadedData())), work),
    keep: () => cache?.merge(scope.loadedData()),
  };
});

/** JSON with sorted object keys, so equal inputs give one request key. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) return current;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(current).sort()) sorted[key] = (current as Record<string, unknown>)[key];
    return sorted;
  }) ?? "null";
}

/** Reads the signals of an input, at any depth of plain objects and arrays. */
function unwrap(value: unknown): unknown {
  if (isSignal(value)) return unwrap(value.value);
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrap(entry)]));
  }
  return value;
}

function readerOf(input: unknown): () => unknown {
  return typeof input === "function" ? () => unwrap((input as () => unknown)()) : () => unwrap(input);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireSetup(label: string): "render" | "mount" {
  const phase = setupPhase();
  if (!phase) throw new Error(`${label} must be called while a component script runs, at the top level of <script>`);
  return phase;
}

/** What `<MeekoAwait>` reads of a resource besides its public signals. */
export interface ResourceInternals {
  /** Request key of the current input, as in the page payload. */
  readonly key: ReadonlySignal<string>;
  /** Whether `data` holds the result of a load. */
  readonly loaded: ReadonlySignal<boolean>;
}

/** Key of {@link ResourceInternals} on the resources of `useApi` and `useRpcQuery`. */
export const resourceInternals: unique symbol = Symbol("meeko.resource");

interface ResourceSource {
  readonly label: string;
  readonly read: () => unknown;
  readonly key: (input: unknown) => string;
  readonly fetch: (input: unknown, signal: AbortSignal | undefined) => Promise<unknown>;
}

/** `enabled` as a function that reads its signals; `true` when left out. */
function enabledReader(value: unknown, label: string): () => boolean {
  if (value === undefined) return () => true;
  if (typeof value === "boolean") return () => value;
  if (isSignal(value)) return () => Boolean(value.value);
  if (typeof value === "function") return () => Boolean((value as () => unknown)());
  throw new TypeError(`${label}: enabled must be a boolean, a signal or a function that returns one`);
}

function createResource<T>(source: ResourceSource, options: DataResourceOptions | undefined): DataResource<T> {
  const phase = requireSetup(source.label);
  if (options !== undefined && (typeof options !== "object" || options === null)) {
    throw new TypeError(`${source.label}: the last argument must be an object such as { keepPrevious: false }`);
  }
  const keepPrevious = options?.keepPrevious !== false;
  const debounceMs = options?.debounceMs ?? 0;
  if (typeof debounceMs !== "number" || !Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new TypeError(`${source.label}: debounceMs must be a number of milliseconds, 0 or more`);
  }
  const isEnabled = enabledReader(options?.enabled, source.label);
  let enabled = untrack(isEnabled);
  const data = signal<T | null>(null);
  const error = signal<Error | null>(null);
  // A disabled resource is not loading anything.
  const pending = signal(enabled);
  const refreshing = signal(false);
  /** Whether `data` holds the result of a load: `null` may be a real output. */
  const loadedOnce = signal(false);
  let input = untrack(source.read);
  let key = source.key(input);
  /** `key` for readers outside: `<MeekoAwait>` follows it. */
  const keySignal = signal(key);
  const cache = findContext(cacheKey);
  let awaited = false;
  let started = false;
  let released = false;
  let controller: AbortController | undefined;
  let inflight: Promise<void> | undefined;
  let generation = 0;
  /** Request key of the input whose result `data` holds. */
  let dataKey: string | undefined;
  /** The wait of `debounceMs` before the next request. */
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Stops the wait and the request in flight; a result that still arrives is ignored. */
  const cancel = (): void => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    if (controller) { controller.abort(); controller = undefined; generation++; inflight = undefined; }
  };
  const disabled = (): Error => new Error(`${source.label} is disabled (enabled is false): an awaited resource needs its data. Leave out await, or enable it`);
  const load = (): Promise<void> => {
    if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
    started = true;
    controller?.abort();
    const current = new AbortController();
    controller = current;
    const id = ++generation;
    const requestKey = key;
    batch(() => {
      pending.value = true;
      refreshing.value = untrack(() => loadedOnce.value);
    });
    const run = source.fetch(input, current.signal).then((value) => {
      if (id !== generation || released) return;
      batch(() => { data.value = value as T; error.value = null; pending.value = false; refreshing.value = false; loadedOnce.value = true; });
      dataKey = requestKey;
      cache?.set(requestKey, value);
    }, (failure: unknown) => {
      if (id !== generation || released || current.signal.aborted) return;
      batch(() => { error.value = toError(failure); pending.value = false; refreshing.value = false; });
    }).finally(() => { if (inflight === run) inflight = undefined; });
    inflight = run;
    return run;
  };
  const loaded = (value: unknown): LoadedResource<T> => {
    batch(() => { data.value = value as T; error.value = null; pending.value = false; refreshing.value = false; loadedOnce.value = true; });
    dataKey = key;
    return view;
  };
  /** A disabled resource requests nothing, also on `refresh()`. */
  const refresh = (): Promise<void> => enabled ? load() : Promise.resolve();
  const internals: ResourceInternals = { key: keySignal, loaded: loadedOnce };
  const view: LoadedResource<T> = Object.assign({ data: data as ReadonlySignal<T>, error, pending, refreshing, refresh }, { [resourceInternals]: internals });
  const settle = (): Promise<LoadedResource<T>> => {
    awaited = true;
    if (!enabled) return Promise.reject(disabled());
    const ready = untrack(() => !pending.value && error.value === null);
    const run = inflight ?? (ready ? Promise.resolve() : load());
    return run.then(() => {
      const failure = untrack(() => error.value);
      if (failure) throw failure;
      return view;
    });
  };
  const readNow = (): LoadedResource<T> => {
    awaited = true;
    if (!enabled) throw disabled();
    const describe = `${source.label} (${key})`;
    if (activeScope) {
      const scope = activeScope;
      const entry = scope.entry(key);
      if (entry?.status === "resolved") { scope.markUsed(key); return loaded(entry.value); }
      if (entry?.status === "rejected") throw entry.error;
      // The application already loaded it, for a component that mounts after its page.
      if (!entry && cache?.has(key)) return loaded(cache.get(key));
      if (scope.mode === "collect") {
        const fetchInput = input;
        suspend(entry?.status === "pending" ? entry.promise : scope.load(key, (signal) => source.fetch(fetchInput, signal)), describe);
      }
      // A region that appears after the page, such as an if: that an onMounted shows, loads it then.
      if (canSuspendLate()) suspendLate(describe);
      throw new Error(`MEEKO_RESOURCE_MISSING: ${describe} is not in the page payload; the server and the browser requested different data. Make the input of an awaited ${source.label.split("(")[0]} depend only on props, route data and state`);
    }
    if (cache?.has(key)) return loaded(cache.get(key));
    // A component that mounts later waits for its data; a plain renderToString throws SuspendedRenderError.
    return suspendLate(describe);
  };
  /** A change of the input: the request now, or once the input stays still for `debounceMs`. */
  const schedule = (): void => {
    if (debounceMs === 0) { void load(); return; }
    cancel();
    batch(() => {
      pending.value = true;
      refreshing.value = untrack(() => loadedOnce.value);
    });
    timer = setTimeout(() => {
      timer = undefined;
      if (!released && enabled) void load();
    }, debounceMs);
  };
  if (phase === "mount") {
    onCleanup(() => { released = true; cancel(); });
    let first = true;
    effect(() => {
      const next = source.read();
      const nextKey = source.key(next);
      const nextEnabled = isEnabled();
      if (first) { first = false; return; }
      const keyChanged = nextKey !== key;
      if (!keyChanged && nextEnabled === enabled) return;
      const reenabled = nextEnabled && !enabled;
      input = next;
      key = nextKey;
      enabled = nextEnabled;
      untrack(() => {
        // `keepPrevious: false`: the data of another input is not shown while the new one loads.
        if (keyChanged) {
          batch(() => {
            keySignal.value = nextKey;
            if (!keepPrevious && !awaited) { data.value = null; error.value = null; loadedOnce.value = false; dataKey = undefined; }
          });
        }
        if (!enabled) {
          cancel();
          batch(() => { pending.value = false; refreshing.value = false; });
          return;
        }
        // Enabled again with the input whose data is already shown: nothing to load.
        if (reenabled && dataKey === key && error.value === null) return;
        schedule();
      });
    });
    // Without await, the browser loads the data once the component is mounted.
    whenMounted(() => { if (!awaited && !started && enabled) void load(); });
  }
  const resource = {
    data, error, pending, refreshing,
    refresh,
    [resourceInternals]: internals,
    then<R1 = LoadedResource<T>, R2 = never>(onfulfilled?: ((value: LoadedResource<T>) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
      return settle().then(onfulfilled, onrejected);
    },
    [awaitSync]: readNow,
  };
  return resource;
}

/**
 * Crea `useApi` para los endpoints GET de un manifiesto público. Los clientes generados
 * (`.meeko/generated/clients.*.ts`) lo exportan así; un host propio puede hacer lo mismo.
 *
 * @param manifest Manifiesto público con la lista `api`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useApi`. Al llamarlo con una ruta sin endpoint GET lanza `TypeError`, y
 * fuera del script de un componente, `Error`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseApi } from "@meekojs/meeko/framework";
 * import type { ApiContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }], rpc: [] } as const;
 * export const useApi = createUseApi<ApiContract, typeof manifest>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#load-o-composables
 */
export function createUseApi<Contract extends Record<string, Record<string, AnyApiOperation>>, Manifest extends Pick<PublicServerManifest, "api">>(manifest: Manifest, options: ClientOptions = {}): UseApi<ApiQueryContract<Manifest, Contract>> {
  const useApi = (path: string, input?: unknown, resource?: DataResourceOptions): DataResource<unknown> => {
    const endpoint = manifest.api.find((entry) => entry.pathname === path && entry.method === "GET");
    if (!endpoint) throw new TypeError(`useApi: no GET endpoint at ${path}`);
    return createResource({
      label: `useApi("${path}")`,
      read: readerOf(input),
      key: (value) => `GET ${path} ${stableJson(value ?? {})}`,
      fetch: (value, signal) => requestApi(endpoint, { ...(value as ApiRequestInput | undefined), ...(signal ? { signal } : {}) }, options),
    }, resource);
  };
  return useApi as never;
}

function rpcEndpoint(manifest: Pick<PublicServerManifest, "rpc">, procedure: string, label: string) {
  const endpoint = manifest.rpc.find((entry) => entry.id === procedure);
  if (!endpoint) throw new TypeError(`${label}: unknown RPC procedure ${procedure}`);
  return endpoint;
}

/**
 * Crea `useRpcQuery` para los procedimientos de un manifiesto público, como hacen los clientes
 * generados.
 *
 * @param manifest Manifiesto público con la lista `rpc`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useRpcQuery`. Con un procedimiento desconocido lanza `TypeError`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseRpcQuery } from "@meekojs/meeko/framework";
 * import type { RpcContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [], rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }] } as const;
 * export const useRpcQuery = createUseRpcQuery<RpcContract>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#load-o-composables
 */
export function createUseRpcQuery<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, "rpc">, options: ClientOptions = {}): UseRpcQuery<Contract> {
  const useRpcQuery = (procedure: string, input?: unknown, resource?: DataResourceOptions): DataResource<unknown> => {
    const endpoint = rpcEndpoint(manifest, procedure, "useRpcQuery");
    return createResource({
      label: `useRpcQuery("${procedure}")`,
      // An RPC body is JSON: a left-out input sends `{}`.
      read: readerOf(input === undefined ? {} : input),
      key: (value) => `RPC ${procedure} ${stableJson(value)}`,
      fetch: (value, signal) => requestRpc(endpoint, value, signal ? { signal } : {}, options),
    }, resource);
  };
  return useRpcQuery as never;
}

/**
 * Crea `useRpcMutation` para los procedimientos de un manifiesto público, como hacen los clientes
 * generados. El composable acepta desde `1.2` las opciones de mutación (`retrySafe`).
 *
 * @param manifest Manifiesto público con la lista `rpc`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useRpcMutation`. Con un procedimiento desconocido lanza `TypeError`, y
 * fuera del script de un componente, `Error`.
 * @since 1.1.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseRpcMutation } from "@meekojs/meeko/framework";
 * import type { RpcContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [], rpc: [{ id: "users.rename", pathname: "/_meeko/rpc/users/rename" }] } as const;
 * export const useRpcMutation = createUseRpcMutation<RpcContract>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export function createUseRpcMutation<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, "rpc">, options: ClientOptions = {}): UseRpcMutation<Contract> {
  const useRpcMutation = (procedure: string, mutationOptions?: MutationOptions): RpcMutation<unknown, unknown> => {
    const label = `useRpcMutation("${procedure}")`;
    requireSetup(label);
    const endpoint = rpcEndpoint(manifest, procedure, "useRpcMutation");
    return createMutation({
      label,
      target: `RPC ${procedure}`,
      send: (input, headers) => requestRpc(endpoint, input, {}, options, headers),
    }, mutationOptions) as RpcMutation<unknown, unknown>;
  };
  return useRpcMutation as never;
}

/**
 * Crea `useApiMutation` para los endpoints `POST`, `PUT`, `PATCH` y `DELETE` de un manifiesto
 * público, como hacen los clientes generados.
 *
 * @param manifest Manifiesto público con la lista `api`.
 * @param options Opciones de transporte: `fetch`, `baseUrl`, cabeceras y CSRF.
 * @returns El composable `useApiMutation`. Con una ruta o un método sin endpoint, o con `GET`, lanza
 * `TypeError`, y fuera del script de un componente, `Error`.
 * @since 1.2.0
 * @example
 * ```ts
 * import { createBrowserClientOptions, createUseApiMutation } from "@meekojs/meeko/framework";
 * import type { ApiContract } from "../types/server-contracts.js";
 *
 * const manifest = { version: 1, api: [{ clientKey: "notes", pathname: "/api/notes", method: "POST" }], rpc: [] } as const;
 * export const useApiMutation = createUseApiMutation<ApiContract, typeof manifest>(manifest, createBrowserClientOptions());
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones
 */
export function createUseApiMutation<Contract extends Record<string, Record<string, AnyApiOperation>>, Manifest extends Pick<PublicServerManifest, "api">>(manifest: Manifest, options: ClientOptions = {}): UseApiMutation<ApiMutationContract<Manifest, Contract>> {
  const useApiMutation = (path: string, method: string, mutationOptions?: MutationOptions): ApiMutation<AnyApiOperation> => {
    const label = `useApiMutation("${path}", "${method}")`;
    requireSetup(label);
    const verb = String(method).toUpperCase();
    if (verb === "GET" || verb === "HEAD") throw new TypeError(`useApiMutation: ${verb} ${path} is a read; use useApi`);
    const endpoint = manifest.api.find((entry) => entry.pathname === path && entry.method === verb);
    if (!endpoint) throw new TypeError(`useApiMutation: no ${verb} endpoint at ${path}`);
    return createMutation({
      label,
      target: `${verb} ${path}`,
      send: (input, headers) => requestApi(endpoint, (input ?? {}) as ApiRequestInput, options, headers),
    }, mutationOptions) as unknown as ApiMutation<AnyApiOperation>;
  };
  return useApiMutation as never;
}
