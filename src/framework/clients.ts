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
  /** Ruta del método en el cliente, separada por puntos: `"users.byId"` da `api.users.byId.get()`. */
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
 * const user = await api.users.byId.get({ params: { id: "123" } });
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
type RequestOptions = { readonly signal?: AbortSignal };
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
type Nest<Path extends string, Value> = Path extends `${infer Head}.${infer Tail}` ? { [K in Head]: Nest<Tail, Value> } : { [K in Path]: Value };
type Intersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Result) => void ? Result : never;
type ApiMethods<Operations> = { [Method in keyof Operations]: Operations[Method] extends AnyApiOperation
  ? (...args: ApiArguments<Operations[Method]>) => Promise<Operations[Method]["output"]>
  : never };
/**
 * Cliente de API tipado: un árbol de objetos según `clientKey` con un método por verbo HTTP
 * (`api.users.byId.get(...)`). Cada método recibe `params`, `query`, `body` y `signal` según su
 * operación y devuelve la salida, o rechaza con {@link ClientError}.
 *
 * @typeParam Contract Contrato `ApiContract` generado, indexado por `clientKey`.
 * @example
 * ```ts
 * import type { ApiClient, ApiOperation } from "@meekojs/meeko/framework";
 *
 * declare const api: ApiClient<{ users: { get: ApiOperation<undefined, { page?: string }, undefined, string[]> } }>;
 * const names = await api.users.get({ query: { page: "2" } });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export type ApiClient<Contract extends Record<string, Record<string, AnyApiOperation>>> = Intersection<{
  [Key in keyof Contract & string]: Nest<Key, ApiMethods<Contract[Key]>>
}[keyof Contract & string]>;
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

function headersFor(options: ClientOptions, method: string, json: boolean): Headers {
  const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
  if (json) headers.set("content-type", "application/json");
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

function ensureObject(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const parts = key.split(".");
  if (parts.some((part) => !/^[A-Za-z_$][\w$]*$/.test(part))) throw new TypeError(`Invalid client key: ${key}`);
  let node = root;
  for (const part of parts) {
    const existing = node[part];
    if (existing === undefined) node[part] = Object.create(null) as Record<string, unknown>;
    else if (!existing || typeof existing !== "object") throw new TypeError(`Client key collision: ${key}`);
    node = node[part] as Record<string, unknown>;
  }
  return node;
}

/** Input of one API request, as `api.*` methods receive it. */
export interface ApiRequestInput {
  readonly params?: Readonly<Record<string, string>>;
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

/** Sends one request to a public API endpoint; `api.*` and `useApi` share it. */
export async function requestApi(endpoint: PublicApiEndpoint, input: ApiRequestInput, options: ClientOptions): Promise<unknown> {
  const path = pathWithParams(endpoint.pathname, input.params) + queryString(input.query);
  const url = endpointUrl(path, options);
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(url, {
    method: endpoint.method, headers: headersFor(options, endpoint.method, input.body !== undefined),
    credentials: "same-origin", ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return responseValue(response, endpoint.contentType);
}

/** Calls one RPC procedure, with the session's CSRF token; `rpc.*` and the RPC composables share it. */
export async function requestRpc(endpoint: PublicRpcEndpoint, input: unknown, request: RequestOptions, options: ClientOptions): Promise<unknown> {
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(endpointUrl(endpoint.pathname, options), {
    method: "POST", headers: headersFor(options, "POST", true), credentials: "same-origin",
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
 * @throws {TypeError} Si dos endpoints producen el mismo método o un `clientKey` no es válido.
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
  const root: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.api) {
    const methods = ensureObject(root, endpoint.clientKey);
    const method = endpoint.method.toLowerCase();
    if (methods[method]) throw new TypeError(`Duplicate API method: ${endpoint.clientKey}.${method}`);
    methods[method] = (input: ApiRequestInput = {}) => requestApi(endpoint, input, options);
  }
  return root as ApiClient<Contract>;
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
