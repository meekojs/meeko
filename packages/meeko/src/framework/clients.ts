/**
 * Descriptor público de un endpoint de API. Omite a propósito el archivo del handler y los schemas
 * del servidor, así que puede viajar al navegador.
 *
 * @example
 * ```ts
 * import type { PublicApiEndpoint } from "@meekojs/meeko/framework";
 *
 * // server/api/users/[id].get.ts
 * const endpoint: PublicApiEndpoint = { clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" };
 * ```
 */
export interface PublicApiEndpoint {
  /**
   * Ruta del método en el cliente, separada por puntos. Un segmento `by` + parámetro con mayúscula
   * inicial es el segmento dinámico de ese parámetro: `"users.byId"` con `/api/users/[id]` da
   * `api.users({ id }).get()`.
   */
  readonly clientKey: string;
  /** Ruta HTTP con los segmentos dinámicos entre corchetes. */
  readonly pathname: string;
  /** Método HTTP del endpoint. */
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** `"response"` entrega el `Response` sin leerlo; por defecto, `"json"`. */
  readonly contentType?: "json" | "response";
}

/**
 * Descriptor público de un procedimiento RPC, sin el archivo del handler.
 *
 * @example
 * ```ts
 * import type { PublicRpcEndpoint } from "@meekojs/meeko/framework";
 *
 * // server/rpc/users/get.ts
 * const procedure: PublicRpcEndpoint = { id: "users.get", pathname: "/_meeko/rpc/users/get" };
 * ```
 */
export interface PublicRpcEndpoint {
  /** ID con puntos del procedimiento; también es su ruta en `rpc.*`. */
  readonly id: string;
  /** Ruta HTTP bajo `/_meeko/rpc`. */
  readonly pathname: string;
}

/**
 * Manifiesto público del servidor: los endpoints de API y RPC que pueden llamar los clientes, sin
 * rutas privadas. Es la entrada de `createApiClient`, `createRpcClient` y los composables de datos.
 *
 * @example
 * ```ts
 * import { createRpcClient } from "@meekojs/meeko/framework";
 * import type { PublicServerManifest } from "@meekojs/meeko/framework";
 *
 * const manifest: PublicServerManifest = {
 *   api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }],
 *   rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }],
 * };
 * const rpc = createRpcClient<{ "users.get": { input: { id: string }; output: { name: string } } }>(manifest);
 * ```
 */
export interface PublicServerManifest {
  /** Endpoints de API. */
  readonly api: readonly PublicApiEndpoint[];
  /** Procedimientos RPC. */
  readonly rpc: readonly PublicRpcEndpoint[];
}

/**
 * Quita del manifiesto descubierto del servidor las rutas privadas de los handlers, para poder
 * serializarlo y enviarlo al navegador.
 *
 * @param manifest Manifiesto con, como mínimo, los campos públicos de cada endpoint.
 * @returns Un manifiesto nuevo con sólo `clientKey`, `pathname`, `method`, `contentType`, `id`.
 * @example
 * ```ts
 * import { discoverServerManifest } from "@meekojs/meeko/build";
 * import { createPublicServerManifest } from "@meekojs/meeko/framework";
 *
 * const manifest = await discoverServerManifest(process.cwd());
 * const json = JSON.stringify(createPublicServerManifest(manifest));
 * ```
 */
export function createPublicServerManifest(manifest: PublicServerManifest): PublicServerManifest {
  return {
    api: manifest.api.map(({ clientKey, pathname, method, contentType }) => ({
      clientKey, pathname, method, ...(contentType ? { contentType } : {}),
    })),
    rpc: manifest.rpc.map(({ id, pathname }) => ({ id, pathname })),
  };
}

/**
 * Declaración de tipos de una operación de API, que el contrato generado infiere de los schemas
 * públicos de `shared/`. `undefined` en un campo indica que la operación no lo acepta.
 *
 * @example
 * ```ts
 * import { createApiClient } from "@meekojs/meeko/framework";
 * import type { ApiOperation } from "@meekojs/meeko/framework";
 *
 * type GetUser = ApiOperation<{ id: string }, undefined, undefined, { id: string; name: string }>;
 * const api = createApiClient<{ "users.byId": { get: GetUser } }>({
 *   api: [{ clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" }],
 * });
 * const user = await api.users({ id: "123" }).get();
 * ```
 */
export interface ApiOperation<Params = undefined, Query = undefined, Body = undefined, Output = unknown> {
  /** Segmentos dinámicos de la ruta. */
  readonly params: Params;
  /** Parámetros de la query string. */
  readonly query: Query;
  /** Cuerpo JSON de la petición. */
  readonly body: Body;
  /** Respuesta del endpoint. */
  readonly output: Output;
}

/**
 * Declaración de tipos de un procedimiento RPC: su entrada y su salida.
 *
 * @example
 * ```ts
 * import { createRpcClient } from "@meekojs/meeko/framework";
 * import type { RpcOperation } from "@meekojs/meeko/framework";
 *
 * type Contract = { "users.get": RpcOperation<{ id: string }, { id: string; name: string }> };
 * const rpc = createRpcClient<Contract>({ rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }] });
 * const user = await rpc.users.get({ id: "123" });
 * ```
 */
export interface RpcOperation<Input = unknown, Output = unknown> {
  /** Entrada del procedimiento. */
  readonly input: Input;
  /** Salida del procedimiento. */
  readonly output: Output;
}

export type AnyApiOperation = ApiOperation<unknown, unknown, unknown, unknown>;

type SearchValue = string | number | boolean | null | undefined;
export type QueryValue = SearchValue | readonly SearchValue[];
/** Options of one call of `api.*` and `rpc.*`, beside its contract input. */
type RequestOptions = {
  /** Cancela la petición. */
  readonly signal?: AbortSignal;
  /**
   * Desde 1.2: UUID que viaja en la cabecera `Idempotency-Key`, para que el servidor reconozca una
   * repetición de la misma escritura. Uno que no es un UUID rechaza con `TypeError` sin enviar nada.
   */
  readonly idempotencyKey?: string;
};
/**
 * The `Key` option for a contract value `T`. It does not distribute over `T`, so a value typed as
 * the whole union (`{ body: A | B }`) is accepted, not only one member at a time. An absent value
 * (`undefined`) forbids the option, an `undefined` member, `any` or `Optional` makes it optional,
 * and `unknown` keeps it required.
 */
type ContractOption<Key extends string, T, Optional extends boolean = false> = 0 extends 1 & T ? { readonly [K in Key]?: T }
  : [T] extends [undefined] ? { readonly [K in Key]?: never }
  : unknown extends T ? { readonly [K in Key]: T }
  : undefined extends T ? { readonly [K in Key]?: Exclude<T, undefined> }
  : Optional extends true ? { readonly [K in Key]?: T } : { readonly [K in Key]: T };
type ParamOption<T> = ContractOption<"params", T>;
/** A query whose fields are all optional (it accepts `{}`) may be left out. */
type QueryOption<T> = ContractOption<"query", T, {} extends T ? true : false>;
type BodyOption<T> = ContractOption<"body", T>;
type OptionalQuery<Q> = [Q] extends [undefined] ? true : {} extends Q ? true : false;
type ApiArguments<O extends AnyApiOperation> = O["params"] extends undefined
  ? OptionalQuery<O["query"]> extends true
    ? O["body"] extends undefined ? [options?: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions] : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions]
    : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions]
  : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions];
/**
 * Entrada de una operación de API que no es `GET`, sin `signal`: `params`, `query` y `body` según
 * su contrato. Es lo que recibe `mutate` de `useApiMutation` y lo que guarda una mutación
 * `retrySafe` mientras su resultado es incierto.
 *
 * @typeParam O Operación del contrato de API.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ApiMutationInput, ApiOperation } from "@meekojs/meeko/framework";
 *
 * type CreateSale = ApiOperation<undefined, undefined, { total: number }, { id: string }>;
 * const input: ApiMutationInput<CreateSale> = { body: { total: 1200 } };
 * ```
 */
export type ApiMutationInput<O extends AnyApiOperation> = ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]>;
/** `mutate()` may be called without its input when the operation requires nothing. */
export type ApiMutationArguments<O extends AnyApiOperation> = O["params"] extends undefined
  ? OptionalQuery<O["query"]> extends true
    ? O["body"] extends undefined ? [input?: ApiMutationInput<O>] : [input: ApiMutationInput<O>]
    : [input: ApiMutationInput<O>]
  : [input: ApiMutationInput<O>];
type Nest<Path extends string, Value> = Path extends `${infer Head}.${infer Tail}` ? { [K in Head]: Nest<Tail, Value> } : { [K in Path]: Value };
type Intersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Result) => void ? Result : never;
/** The params still missing once a segment call bound `Bound`; none left forbids the option. */
type RemainingParams<Params, Bound extends string> = 0 extends 1 & Params ? Params
  : Params extends object ? [Exclude<keyof Params, Bound>] extends [never] ? undefined : Omit<Params, Bound>
  : Params;
type BoundOperation<Operation extends AnyApiOperation, Bound extends string> = [Bound] extends [never] ? Operation
  : ApiOperation<RemainingParams<Operation["params"], Bound>, Operation["query"], Operation["body"], Operation["output"]>;
type ApiMethods<Operations, Bound extends string = never> = { [Method in keyof Operations]: Operations[Method] extends AnyApiOperation
  ? (...args: ApiArguments<BoundOperation<Operations[Method], Bound>>) => Promise<Operations[Method]["output"]>
  : never };
/**
 * A method reached through a `byId` segment: it still takes `params` and is deprecated. The reason
 * stays on one line because editors show it as the message of the hint.
 */
interface DeprecatedApiMethod<Args extends unknown[], Output> {
  /** @deprecated Desde 1.2.0: llame al segmento dinámico con sus parámetros, como `api.users({ id }).get()` en lugar de `api.users.byId.get({ params: { id } })`. Se retirará en 2.0. */
  (...args: Args): Promise<Output>;
}
type DeprecatedApiMethods<Operations> = { [Method in keyof Operations]: Operations[Method] extends AnyApiOperation
  ? DeprecatedApiMethod<ApiArguments<Operations[Method]>, Operations[Method]["output"]>
  : never };
/** The route parameter names of one client key, which name its dynamic segments. */
type RouteParamNames<Operations> = { [Method in keyof Operations]: Operations[Method] extends { readonly params: infer Params }
  ? 0 extends 1 & Params ? never : Params extends object ? keyof Params & string : never
  : never }[keyof Operations];
/** `byId` is the dynamic segment of the route parameter `id`; any other name is static. */
type SegmentParam<Segment extends string, Names extends string> = Names extends unknown ? Segment extends `by${Capitalize<Names>}` ? Names : never : never;
type ClientSegment<Name extends string, Param extends string> = { readonly name: Name; readonly param: Param };
type ClientPath<Key extends string, Names extends string> = Key extends `${infer Head}.${infer Tail}`
  ? [ClientSegment<Head, SegmentParam<Head, Names>>, ...ClientPath<Tail, Names>]
  : [ClientSegment<Key, SegmentParam<Key, Names>>];
/** One client key of the contract as its segments, below the node that is being typed. */
type ClientEntries<Contract> = { [Key in keyof Contract & string]: { readonly path: ClientPath<Key, RouteParamNames<Contract[Key]>>; readonly operations: Contract[Key] } }[keyof Contract & string];
type EntryHead<Entries> = Entries extends { readonly path: readonly [infer Head, ...unknown[]] } ? Head : never;
type SegmentNames<Entries> = EntryHead<Entries> extends infer Head ? Head extends { readonly name: infer Name extends string } ? Name : never : never;
type StaticNames<Entries> = EntryHead<Entries> extends infer Head ? Head extends { readonly name: infer Name extends string; readonly param: infer Param } ? [Param] extends [never] ? Name : never : never : never;
type DynamicSegments<Entries> = EntryHead<Entries> extends infer Head ? Head extends { readonly param: infer Param } ? [Param] extends [never] ? never : Head : never : never;
type DynamicNames<Entries> = DynamicSegments<Entries> extends infer Head ? Head extends { readonly name: infer Name extends string } ? Name : never : never;
type ChildEntries<Entries, Name extends string> = Entries extends { readonly path: readonly [{ readonly name: Name }, ...infer Tail]; readonly operations: infer Operations }
  ? { readonly path: Tail; readonly operations: Operations } : never;
type NodeOperations<Entries> = Entries extends { readonly path: readonly []; readonly operations: infer Operations } ? Operations : never;
/** One call signature per dynamic child: `node({ id })` binds `id` and returns that child. */
type SegmentCalls<Entries, Bound extends string> = Intersection<DynamicSegments<Entries> extends infer Segment
  ? Segment extends ClientSegment<infer Name, infer Param>
    ? (params: { readonly [Key in Param]: string }) => ApiNode<ChildEntries<Entries, Name>, Bound | Param>
    : never
  : never>;
/**
 * A node of the client: methods, static children, segment calls and, before any call, the `byId`
 * aliases. The outer conditional keeps hovers structural, since a resolved conditional type is not
 * shown as `ApiNode<...>`.
 */
type ApiNode<Entries, Bound extends string> = [Entries] extends [never] ? unknown
  : ([NodeOperations<Entries>] extends [never] ? unknown : ApiMethods<NodeOperations<Entries>, Bound>)
    & ([StaticNames<Entries>] extends [never] ? unknown : { [Name in StaticNames<Entries>]: ApiNode<ChildEntries<Entries, Name>, Bound> })
    & SegmentCalls<Entries, Bound>
    & ([Bound] extends [never] ? [DynamicNames<Entries>] extends [never] ? unknown : { [Name in DynamicNames<Entries>]: DeprecatedApiNode<ChildEntries<Entries, Name>> } : unknown);
/** The subtree below a `byId` alias, as in 1.0 and 1.1: every method takes all its `params`. */
type DeprecatedApiNode<Entries> = [Entries] extends [never] ? unknown
  : ([NodeOperations<Entries>] extends [never] ? unknown : DeprecatedApiMethods<NodeOperations<Entries>>)
    & ([SegmentNames<Entries>] extends [never] ? unknown : { [Name in SegmentNames<Entries>]: DeprecatedApiNode<ChildEntries<Entries, Name>> });
/**
 * Cliente de API tipado: un árbol según `clientKey` con un método por verbo HTTP. Un segmento
 * dinámico se llama con sus parámetros (`api.users({ id }).get()`); los métodos que se alcanzan así
 * ya no reciben `params`. Cada método recibe `query`, `body` y `signal` según su operación y
 * devuelve la salida, o rechaza con {@link ClientError}.
 *
 * El segmento de `clientKey` que forma `by` con el nombre en mayúscula inicial de un parámetro de
 * la ruta (`byId` para `[id]` o `[...id]`) es el segmento dinámico de ese parámetro. Desde `1.2`,
 * la forma `api.users.byId.get({ params: { id } })` sigue funcionando pero está obsoleta y se
 * retirará en `2.0`.
 *
 * @typeParam Contract Contrato `ApiContract` generado, indexado por `clientKey`.
 * @example
 * ```ts
 * import type { ApiClient, ApiOperation } from "@meekojs/meeko/framework";
 *
 * declare const api: ApiClient<{ users: { get: ApiOperation<undefined, { page?: string }, undefined, string[]> } }>;
 * const names = await api.users.get({ query: { page: "2" } });
 * ```
 * Segmentos dinámicos, desde `1.2`:
 * ```ts
 * import type { ApiClient, ApiOperation } from "@meekojs/meeko/framework";
 *
 * type User = { id: string; name: string };
 * declare const api: ApiClient<{
 *   "users.byId": { get: ApiOperation<{ id: string }, undefined, undefined, User> };
 *   "orgs.byOrg.users.byId": { delete: ApiOperation<{ org: string; id: string }, undefined, undefined, undefined> };
 * }>;
 * const user = await api.users({ id: "123" }).get();
 * await api.orgs({ org: "acme" }).users({ id: "123" }).delete();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export type ApiClient<Contract extends Record<string, Record<string, AnyApiOperation>>> = ApiNode<ClientEntries<Contract>, never>;
/**
 * Cliente RPC tipado: un árbol de funciones según el ID de cada procedimiento
 * (`rpc.users.get(input, { signal })`), que devuelven su salida o rechazan con {@link ClientError}.
 *
 * @typeParam Contract Contrato `RpcContract` generado, indexado por ID de procedimiento.
 * @example
 * ```ts
 * import type { RpcClient, RpcOperation } from "@meekojs/meeko/framework";
 *
 * declare const rpc: RpcClient<{ "users.get": RpcOperation<{ id: string }, { name: string }> }>;
 * const user = await rpc.users.get({ id: "123" }, { signal: AbortSignal.timeout(5_000) });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export type RpcClient<Contract extends Record<string, RpcOperation>> = Intersection<{
  [Key in keyof Contract & string]: Nest<Key, (input: Contract[Key]["input"], options?: RequestOptions) => Promise<Contract[Key]["output"]>>
}[keyof Contract & string]>;

/**
 * Un mensaje del schema sobre un campo de la entrada que el servidor rechazó con `400`
 * (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY` o `INVALID_INPUT`). Lo llevan
 * `ClientError.issues` y el campo `issues` de la respuesta JSON.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ValidationIssue } from "@meekojs/meeko/framework";
 *
 * const fieldErrors = (issues: readonly ValidationIssue[] = []): Record<string, string> =>
 *   Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
 * ```
 */
export interface ValidationIssue {
  /** Claves del campo unidas con `.`, como `"items.0.name"`; `""` para la entrada completa. */
  readonly path: string;
  /** Mensaje del schema, como el de `v.minLength(1, "Escribe tu contraseña.")`. */
  readonly message: string;
}

function validationIssues(value: unknown): readonly ValidationIssue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const issues: ValidationIssue[] = [];
  for (const item of value as unknown[]) {
    if (item === null || typeof item !== "object") continue;
    const { path, message } = item as { path?: unknown; message?: unknown };
    if (typeof path === "string" && typeof message === "string") issues.push(Object.freeze({ path, message }));
  }
  return issues.length ? Object.freeze(issues) : undefined;
}

/**
 * Error que lanzan los clientes de API y RPC ante una respuesta no correcta. `message` es el
 * código. Una respuesta de error sin `code` usa `HTTP_ERROR`, y una respuesta correcta que no es
 * JSON, `INVALID_RESPONSE`.
 *
 * @example
 * ```ts
 * import { ClientError } from "@meekojs/meeko/framework";
 *
 * try {
 *   await rpc.users.rename({ id: "1", name: "" });
 * } catch (error) {
 *   if (error instanceof ClientError && error.status === 400) console.warn(error.code, error.requestId);
 *   else throw error;
 * }
 * ```
 * Los mensajes de validación llegan a un formulario por `issues`:
 * ```ts
 * import { ClientError } from "@meekojs/meeko/framework";
 *
 * try {
 *   await rpc.auth.login({ email, password });
 * } catch (error) {
 *   if (!(error instanceof ClientError) || !error.issues) throw error;
 *   for (const issue of error.issues) fieldErrors.set(issue.path, issue.message);
 * }
 * ```
 */
export class ClientError extends Error {
  /**
   * @param code Código de error del servidor, como `NOT_FOUND` o `INTERNAL_ERROR`.
   * @param status Estado HTTP de la respuesta.
   * @param requestId ID de la petición (`x-request-id`), si el servidor lo envió.
   * @param issues Mensajes del schema de una entrada no válida (desde `1.2`), o `undefined` si la
   * respuesta no los trae.
   */
  constructor(public readonly code: string, public readonly status: number, public readonly requestId?: string, public readonly issues?: readonly ValidationIssue[]) {
    super(code);
    this.name = "ClientError";
  }
}

/** Brand of `ClientError`; `Symbol.for` so two copies of Meeko in one page recognize each other's. */
const clientErrorBrand: unique symbol = Symbol.for("meeko.client-error") as never;
Object.defineProperty(ClientError.prototype, clientErrorBrand, { value: true });

/**
 * Comprueba si `error` es un {@link ClientError} y, con `code`, si tiene ese código. Sirve en los
 * observadores de errores, que reciben `unknown`, y reconoce también el `ClientError` de otra copia
 * de Meeko en la misma página, donde `instanceof` falla.
 *
 * @param error Valor que se comprueba, como el `error` de `onError`.
 * @param code Código esperado, como `UNAUTHENTICATED` o `NOT_FOUND`; sin él, cualquier código.
 * @returns `true` si es un `ClientError` con ese código.
 * @since 1.3.0
 * @example
 * ```ts
 * import { isClientError, mountClientApp } from "@meekojs/meeko/framework";
 *
 * await mountClientApp({
 *   ...options,
 *   onError(error, source) {
 *     if (isClientError(error, "UNAUTHENTICATED")) location.assign("/login");
 *     else if (isClientError(error)) console.warn(source, error.code, error.requestId);
 *     else console.error(source, error);
 *   },
 * });
 * ```
 */
export function isClientError<const Code extends string = string>(error: unknown, code?: Code): error is ClientError & { readonly code: Code } {
  if (!(error instanceof ClientError) && !(typeof error === "object" && error !== null && (error as { [clientErrorBrand]?: unknown })[clientErrorBrand] === true)) return false;
  return code === undefined || (error as ClientError).code === code;
}

/**
 * Opciones de transporte de los clientes de API y RPC y de los composables de datos. Las que
 * aceptan una función la evalúan en cada petición.
 *
 * @example
 * ```ts
 * import { createApiClient } from "@meekojs/meeko/framework";
 * import type { ClientOptions } from "@meekojs/meeko/framework";
 *
 * const options: ClientOptions = {
 *   baseUrl: "https://example.com",
 *   headers: () => ({ authorization: `Bearer ${localStorage.getItem("token") ?? ""}` }),
 * };
 * const api = createApiClient(manifest, options);
 * ```
 */
export interface ClientOptions {
  /** Origen o URL base contra la que se resuelven las rutas; sin él, rutas relativas. */
  readonly baseUrl?: string | (() => string);
  /** Implementación de `fetch`; por defecto, la global. */
  readonly fetch?: typeof fetch;
  /** Token CSRF que se envía en `x-meeko-csrf` en los métodos distintos de GET y HEAD. */
  readonly csrfToken?: string | (() => string | undefined);
  /** Cabeceras adicionales de cada petición. */
  readonly headers?: HeadersInit | (() => HeadersInit);
}

/**
 * Opciones de cliente para el navegador: leen el token CSRF de la meta `meeko-csrf-token` en cada
 * llamada, también tras navegar, y la actualizan con la cabecera `x-meeko-csrf-token` de las
 * respuestas, salvo que el documento o el token hayan cambiado durante la petición.
 *
 * @returns Opciones con `csrfToken` y `fetch`.
 * @example
 * ```ts
 * import { createApiClient, createBrowserClientOptions } from "@meekojs/meeko/framework";
 *
 * export const api = createApiClient<ApiContract>(manifest, createBrowserClientOptions());
 * ```
 */
export function createBrowserClientOptions(): ClientOptions {
  const currentCsrfToken = (): string | undefined => typeof document === "undefined"
    ? undefined
    : document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute("content") ?? undefined;
  return {
    csrfToken: currentCsrfToken,
    fetch: async (input, init) => {
      const sourceDocument = typeof document === "undefined" ? undefined : document;
      const csrfTokenAtStart = currentCsrfToken();
      const response = await fetch(input, init);
      const token = response.headers.get("x-meeko-csrf-token");
      // Navigation or a newer response may have rotated or cleared the token.
      if (token !== null && sourceDocument && document === sourceDocument && currentCsrfToken() === csrfTokenAtStart) {
        let meta = document.querySelector('meta[name="meeko-csrf-token"]');
        if (!token) {
          meta?.remove();
          return response;
        }
        if (!meta) {
          meta = document.createElement("meta");
          meta.setAttribute("name", "meeko-csrf-token");
          document.head.append(meta);
        }
        meta.setAttribute("content", token);
      }
      return response;
    },
  };
}

function pathWithParams(pathname: string, params: Readonly<Record<string, string>> = {}): string {
  const used = new Set<string>();
  const path = pathname.replace(/\[(\.\.\.)?([A-Za-z_$][\w$]*)\]/g, (_match, rest: string | undefined, name: string) => {
    const value = params[name];
    if (!value) throw new TypeError(`Missing route parameter: ${name}`);
    used.add(name);
    const parts = rest ? value.split("/") : [value];
    if (parts.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) throw new TypeError(`Invalid route parameter: ${name}`);
    return parts.map(encodeURIComponent).join("/");
  });
  for (const key of Object.keys(params)) if (!used.has(key)) throw new TypeError(`Unknown route parameter: ${key}`);
  return path;
}

function queryString(query: Readonly<Record<string, QueryValue>> | undefined): string {
  if (!query) return "";
  const search = new URLSearchParams();
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      if (value !== null && value !== undefined) search.append(key, String(value));
    }
  }
  const result = search.toString();
  return result ? `?${result}` : "";
}

async function responseValue(response: Response, contentType: "json" | "response" = "json"): Promise<unknown> {
  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.json(); } catch { /* Bad error bodies still produce a normalized error. */ }
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const code = typeof record.code === "string" ? record.code : "HTTP_ERROR";
    const requestId = typeof record.requestId === "string" ? record.requestId : response.headers.get("x-request-id") ?? undefined;
    throw new ClientError(code, response.status, requestId, validationIssues(record.issues));
  }
  if (contentType === "response") return response;
  if (response.status === 204) return undefined;
  try { return await response.json(); }
  catch { throw new ClientError("INVALID_RESPONSE", response.status, response.headers.get("x-request-id") ?? undefined); }
}

function endpointUrl(pathname: string, options: ClientOptions): string {
  const baseUrl = typeof options.baseUrl === "function" ? options.baseUrl() : options.baseUrl;
  return baseUrl ? new URL(pathname, baseUrl).toString() : pathname;
}

function headersFor(options: ClientOptions, method: string, json: boolean, extra?: Readonly<Record<string, string>>): Headers {
  const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
  if (json) headers.set("content-type", "application/json");
  for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  if (method !== "GET" && method !== "HEAD") {
    const csrf = typeof options.csrfToken === "function" ? options.csrfToken() : options.csrfToken;
    if (csrf) headers.set("x-meeko-csrf", csrf);
  }
  return headers;
}

function insert(root: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  if (parts.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) throw new TypeError(`Invalid client key: ${key}`);
  let node = root;
  for (const part of parts.slice(0, -1)) {
    const existing = node[part];
    if (existing === undefined) node[part] = Object.create(null) as Record<string, unknown>;
    else if (!existing || typeof existing !== "object") throw new TypeError(`Client key collision: ${key}`);
    node = node[part] as Record<string, unknown>;
  }
  const last = parts.at(-1)!;
  if (node[last] !== undefined) throw new TypeError(`Client key collision: ${key}`);
  node[last] = value;
}

/** The API client as a tree of segments; a child with `param` is a dynamic segment. */
interface ApiTree {
  readonly methods: Map<string, PublicApiEndpoint>;
  readonly children: Map<string, { readonly param: string | undefined; readonly tree: ApiTree }>;
}

const apiTree = (): ApiTree => ({ methods: new Map(), children: new Map() });

/** `byId` names the dynamic segment `[id]` or `[...id]` in a client key, as the manifest builds it. */
const segmentAlias = (param: string): string => `by${param[0]!.toUpperCase()}${param.slice(1)}`;

function addApiEndpoint(root: ApiTree, endpoint: PublicApiEndpoint): void {
  const key = endpoint.clientKey;
  const segments = key.split(".");
  if (segments.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) throw new TypeError(`Invalid client key: ${key}`);
  const params = [...endpoint.pathname.matchAll(/\[(?:\.\.\.)?([A-Za-z_$][\w$]*)\]/g)].map((match) => match[1]!);
  const bound = new Set<string>();
  let tree = root;
  for (const segment of segments) {
    const matches = params.filter((name) => segmentAlias(name) === segment);
    const param = matches[0];
    if (matches.length > 1 || (param !== undefined && bound.has(param))) throw new TypeError(`Ambiguous client key: ${key}`);
    if (param !== undefined) bound.add(param);
    let child = tree.children.get(segment);
    if (!child) tree.children.set(segment, child = { param, tree: apiTree() });
    else if (child.param !== param) throw new TypeError(`Client key collision: ${key}`);
    tree = child.tree;
  }
  const method = endpoint.method.toLowerCase();
  if (tree.methods.has(method)) throw new TypeError(`Duplicate API method: ${key}.${method}`);
  tree.methods.set(method, endpoint);
}

function assertApiTree(tree: ApiTree, path: string): void {
  for (const [name, child] of tree.children) {
    const key = path ? `${path}.${name}` : name;
    if (tree.methods.has(name)) throw new TypeError(`Client key collision: ${key}`);
    assertApiTree(child.tree, key);
  }
}

/**
 * Defines a member of a node. A callable node is a function, as its type says, so a static child
 * named `name` or `length` replaces the function's own property instead of failing to assign it.
 */
function define(node: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(node, key, { value, enumerable: true, writable: true, configurable: true });
}

/** The client of one node; `bound` holds the params of the segment calls that reached it. */
function apiNode(tree: ApiTree, bound: Readonly<Record<string, string>> | undefined, options: ClientOptions): Record<string, unknown> {
  const dynamic = new Map<string, ApiTree>();
  for (const child of tree.children.values()) if (child.param !== undefined) dynamic.set(child.param, child.tree);
  const call = (params: unknown) => {
    const keys = params !== null && typeof params === "object" ? Object.keys(params) : [];
    if (keys.length === 0) throw new TypeError(`Missing route parameter: ${[...dynamic.keys()].join(" | ")}`);
    const unknown = keys.find((key) => !dynamic.has(key)) ?? keys[1];
    if (unknown !== undefined) throw new TypeError(`Unknown route parameter: ${unknown}`);
    const name = keys[0]!;
    return apiNode(dynamic.get(name)!, { ...bound, [name]: (params as Record<string, string>)[name]! }, options);
  };
  const node = (dynamic.size === 0 ? Object.create(null) : call) as Record<string, unknown>;
  for (const [method, endpoint] of tree.methods) {
    define(node, method, bound
      ? (input: ApiRequestInput = {}) => requestApi(endpoint, { ...input, params: { ...input.params, ...bound } }, options)
      : (input: ApiRequestInput = {}) => requestApi(endpoint, input, options));
  }
  for (const [name, child] of tree.children) {
    if (child.param === undefined) define(node, name, apiNode(child.tree, bound, options));
    // The `byId` alias of 1.0 and 1.1 exists only before the first segment call.
    else if (!bound) define(node, name, deprecatedApiNode(child.tree, options));
  }
  return node;
}

/** The subtree below a `byId` alias, as in 1.0 and 1.1: every method takes all its `params`. */
function deprecatedApiNode(tree: ApiTree, options: ClientOptions): Record<string, unknown> {
  const node: Record<string, unknown> = Object.create(null);
  for (const [method, endpoint] of tree.methods) node[method] = (input: ApiRequestInput = {}) => requestApi(endpoint, input, options);
  for (const [name, child] of tree.children) node[name] = deprecatedApiNode(child.tree, options);
  return node;
}

/** Input of one API request, as `api.*` methods receive it. */
export interface ApiRequestInput {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
  readonly idempotencyKey?: string;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether `value` is a UUID that can travel as an idempotency key. */
export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

/** The `Idempotency-Key` header: a Structured Field string, as the IETF draft defines it. */
export function idempotencyHeader(key: string): Record<string, string> {
  return { "idempotency-key": `"${key}"` };
}

/**
 * The headers of a call's own `idempotencyKey`, before the framework's `extra`, which a retry-safe
 * mutation fills with its own key.
 */
function callHeaders(key: unknown, label: string, extra: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> | undefined {
  if (key === undefined) return extra;
  if (!isIdempotencyKey(key)) throw new TypeError(`${label}: idempotencyKey must be a UUID such as crypto.randomUUID() returns`);
  return { ...idempotencyHeader(key), ...extra };
}

/**
 * Sends one request to a public API endpoint; `api.*`, `useApi` and `useApiMutation` share it.
 * `extra` adds headers of the framework, such as `Idempotency-Key`.
 */
export async function requestApi(endpoint: PublicApiEndpoint, input: ApiRequestInput, options: ClientOptions, extra?: Readonly<Record<string, string>>): Promise<unknown> {
  const headers = callHeaders(input.idempotencyKey, `${endpoint.method} ${endpoint.pathname}`, extra);
  const path = pathWithParams(endpoint.pathname, input.params) + queryString(input.query);
  const url = endpointUrl(path, options);
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(url, {
    method: endpoint.method, headers: headersFor(options, endpoint.method, input.body !== undefined, headers),
    credentials: "same-origin", ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return responseValue(response, endpoint.contentType);
}

/** Calls one RPC procedure, with the session's CSRF token; `rpc.*` and the RPC composables share it. */
export async function requestRpc(endpoint: PublicRpcEndpoint, input: unknown, request: RequestOptions, options: ClientOptions, extra?: Readonly<Record<string, string>>): Promise<unknown> {
  const headers = callHeaders(request.idempotencyKey, `rpc ${endpoint.id}`, extra);
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(endpointUrl(endpoint.pathname, options), {
    method: "POST", headers: headersFor(options, "POST", true, headers), credentials: "same-origin",
    body: JSON.stringify(input), ...(request.signal ? { signal: request.signal } : {}),
  });
  return responseValue(response);
}

/**
 * Crea un cliente de API a partir de los descriptores públicos, sin importar código del servidor.
 * Los clientes generados `api` lo usan; sirve también para clientes explícitos o externos.
 *
 * @param manifest Manifiesto público con la lista `api`.
 * @param options Opciones de transporte.
 * @returns El {@link ApiClient} tipado por `Contract`.
 * @throws {TypeError} Si dos endpoints producen el mismo método, un `clientKey` no es válido o un
 * segmento no puede ser a la vez estático y dinámico, o dinámico de dos parámetros.
 * @example
 * ```ts
 * import { createApiClient } from "@meekojs/meeko/framework";
 * import type { ApiOperation } from "@meekojs/meeko/framework";
 *
 * type Contract = { users: { get: ApiOperation<undefined, undefined, undefined, { id: string }[]> } };
 * const api = createApiClient<Contract>(
 *   { api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }] },
 *   { baseUrl: "https://example.com" },
 * );
 * const users = await api.users.get();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function createApiClient<Contract extends Record<string, Record<string, AnyApiOperation>>>(manifest: Pick<PublicServerManifest, "api">, options: ClientOptions = {}): ApiClient<Contract> {
  const tree = apiTree();
  for (const endpoint of manifest.api) addApiEndpoint(tree, endpoint);
  assertApiTree(tree, "");
  return apiNode(tree, undefined, options) as ApiClient<Contract>;
}

/**
 * Crea un cliente RPC a partir de los descriptores públicos. Cada llamada es un `POST` JSON con el
 * token CSRF de `options`.
 *
 * @param manifest Manifiesto público con la lista `rpc`.
 * @param options Opciones de transporte.
 * @returns El {@link RpcClient} tipado por `Contract`.
 * @throws {TypeError} Si dos procedimientos colisionan o un ID no es válido.
 * @example
 * ```ts
 * import { createBrowserClientOptions, createRpcClient } from "@meekojs/meeko/framework";
 * import type { RpcOperation } from "@meekojs/meeko/framework";
 *
 * type Contract = { "users.get": RpcOperation<{ id: string }, { name: string }> };
 * const rpc = createRpcClient<Contract>(
 *   { rpc: [{ id: "users.get", pathname: "/_meeko/rpc/users/get" }] },
 *   createBrowserClientOptions(),
 * );
 * const user = await rpc.users.get({ id: "123" });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function createRpcClient<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, "rpc">, options: ClientOptions = {}): RpcClient<Contract> {
  const root: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.rpc) {
    insert(root, endpoint.id, (input: unknown, request: RequestOptions = {}) => requestRpc(endpoint, input, request, options));
  }
  return root as RpcClient<Contract>;
}
