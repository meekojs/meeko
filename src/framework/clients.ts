/** Public descriptors intentionally omit handler files and server schemas. */
export interface PublicApiEndpoint {
  readonly clientKey: string;
  readonly pathname: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly contentType?: "json" | "response";
}

export interface PublicRpcEndpoint {
  readonly id: string;
  readonly pathname: string;
}

export interface PublicServerManifest {
  readonly api: readonly PublicApiEndpoint[];
  readonly rpc: readonly PublicRpcEndpoint[];
}

/** Strips private handler paths before serializing a discovered server manifest. */
export function createPublicServerManifest(manifest: PublicServerManifest): PublicServerManifest {
  return {
    api: manifest.api.map(({ clientKey, pathname, method, contentType }) => ({
      clientKey, pathname, method, ...(contentType ? { contentType } : {}),
    })),
    rpc: manifest.rpc.map(({ id, pathname }) => ({ id, pathname })),
  };
}

/** Type-only operation declarations can be inferred from public shared schemas. */
export interface ApiOperation<Params = undefined, Query = undefined, Body = undefined, Output = unknown> {
  readonly params: Params;
  readonly query: Query;
  readonly body: Body;
  readonly output: Output;
}

export interface RpcOperation<Input = unknown, Output = unknown> {
  readonly input: Input;
  readonly output: Output;
}

type AnyApiOperation = ApiOperation<unknown, unknown, unknown, unknown>;

type SearchValue = string | number | boolean | null | undefined;
type QueryValue = SearchValue | readonly SearchValue[];
type RequestOptions = { readonly signal?: AbortSignal };
type ParamOption<T> = T extends undefined ? { readonly params?: never } : { readonly params: T };
type QueryOption<T> = T extends undefined ? { readonly query?: never } : { readonly query: T };
type BodyOption<T> = T extends undefined ? { readonly body?: never } : { readonly body: T };
type ApiArguments<O extends AnyApiOperation> = O["params"] extends undefined
  ? O["query"] extends undefined
    ? O["body"] extends undefined ? [options?: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions] : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions]
    : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions]
  : [options: ParamOption<O["params"]> & QueryOption<O["query"]> & BodyOption<O["body"]> & RequestOptions];
type Nest<Path extends string, Value> = Path extends `${infer Head}.${infer Tail}` ? { [K in Head]: Nest<Tail, Value> } : { [K in Path]: Value };
type Intersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (value: infer Result) => void ? Result : never;
type ApiMethods<Operations> = { [Method in keyof Operations]: Operations[Method] extends AnyApiOperation
  ? (...args: ApiArguments<Operations[Method]>) => Promise<Operations[Method]["output"]>
  : never };
export type ApiClient<Contract extends Record<string, Record<string, AnyApiOperation>>> = Intersection<{
  [Key in keyof Contract & string]: Nest<Key, ApiMethods<Contract[Key]>>
}[keyof Contract & string]>;
export type RpcClient<Contract extends Record<string, RpcOperation>> = Intersection<{
  [Key in keyof Contract & string]: Nest<Key, (input: Contract[Key]["input"], options?: RequestOptions) => Promise<Contract[Key]["output"]>>
}[keyof Contract & string]>;

export class ClientError extends Error {
  constructor(public readonly code: string, public readonly status: number, public readonly requestId?: string) {
    super(code);
    this.name = "ClientError";
  }
}

export interface ClientOptions {
  readonly baseUrl?: string | (() => string);
  readonly fetch?: typeof fetch;
  readonly csrfToken?: string | (() => string | undefined);
  readonly headers?: HeadersInit | (() => HeadersInit);
}

/** Reads the current document token at call time, including after client navigation. */
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
    throw new ClientError(code, response.status, requestId);
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

/** Creates browser API methods from public endpoint paths, without server imports. */
export function createApiClient<Contract extends Record<string, Record<string, AnyApiOperation>>>(manifest: Pick<PublicServerManifest, "api">, options: ClientOptions = {}): ApiClient<Contract> {
  const root: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.api) {
    const methods = ensureObject(root, endpoint.clientKey);
    const method = endpoint.method.toLowerCase();
    if (methods[method]) throw new TypeError(`Duplicate API method: ${endpoint.clientKey}.${method}`);
    methods[method] = async (input: { params?: Record<string, string>; query?: Record<string, QueryValue>; body?: unknown; signal?: AbortSignal } = {}) => {
      const path = pathWithParams(endpoint.pathname, input.params) + queryString(input.query);
      const url = endpointUrl(path, options);
      const fetcher = options.fetch ?? fetch;
      const response = await fetcher(url, {
        method: endpoint.method, headers: headersFor(options, endpoint.method, input.body !== undefined),
        credentials: "same-origin", ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      return responseValue(response, endpoint.contentType);
    };
  }
  return root as ApiClient<Contract>;
}

/** Creates browser RPC procedures from public endpoint paths. */
export function createRpcClient<Contract extends Record<string, RpcOperation>>(manifest: Pick<PublicServerManifest, "rpc">, options: ClientOptions = {}): RpcClient<Contract> {
  const root: Record<string, unknown> = Object.create(null);
  for (const endpoint of manifest.rpc) {
    insert(root, endpoint.id, async (input: unknown, request: RequestOptions = {}) => {
      const fetcher = options.fetch ?? fetch;
      const response = await fetcher(endpointUrl(endpoint.pathname, options), {
        method: "POST", headers: headersFor(options, "POST", true), credentials: "same-origin",
        body: JSON.stringify(input), ...(request.signal ? { signal: request.signal } : {}),
      });
      return responseValue(response);
    });
  }
  return root as RpcClient<Contract>;
}
