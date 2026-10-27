import { serializeJson } from "../server.js";
import type { RequestContext } from "./context.js";
import { isAllowedOrigin, SessionSecurityError, type SessionManager } from "./sessions.js";

/**
 * Contrato público de Standard Schema v1 que validan los contratos de API, RPC y Socket. Los
 * schemas de Valibot lo implementan; los públicos viven en `shared/`.
 *
 * @typeParam I Tipo de entrada.
 * @typeParam O Tipo de salida, tras validar y transformar.
 * @example
 * ```ts
 * // shared/schemas/user.ts
 * import * as v from "valibot";
 * import type { Schema } from "@meekojs/meeko/server";
 *
 * export const userSchema: Schema<{ id: string; name: string }> = v.object({ id: v.string(), name: v.string() });
 * ```
 */
export interface Schema<I = unknown, O = I> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => { value: O; issues?: undefined } | { issues: readonly unknown[] } | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type Input<S> = S extends Schema<infer I, unknown> ? I : never;
type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type OptionalOutput<S> = S extends Schema ? Output<S> : undefined;

/**
 * Error público de API, RPC, Socket y loaders: conserva `code` y `status` en la respuesta, que
 * añade `requestId`. Cualquier otro error se responde como `INTERNAL_ERROR`/`500` sin exponer su
 * mensaje.
 *
 * @example
 * ```ts
 * import { ApiError, defineRpc } from "@meekojs/meeko/server";
 * import { findUser } from "../../utils/users.js";
 *
 * export default defineRpc({
 *   input: userParams,
 *   output: userSchema,
 *   handler: async ({ input }) => {
 *     const user = await findUser(input.id);
 *     if (!user) throw new ApiError("USER_NOT_FOUND", 404);
 *     return user;
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export class ApiError extends Error {
  /**
   * @param code Código público, como `USER_NOT_FOUND`.
   * @param status Estado HTTP entre 400 y 599.
   * @param message Mensaje interno; no se envía al cliente. Por defecto, el código.
   */
  constructor(public readonly code: string, public readonly status: number, message = code) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * La familia de la sesión se revocó o su ID fue sustituido. Es el motivo de aborto de
 * `RequestContext.signal` y responde `401 SESSION_REVOKED`. Lo lanza `SessionHandle.verify()`.
 *
 * @example
 * ```ts
 * import { SessionRevokedError } from "@meekojs/meeko/server";
 *
 * try {
 *   await context.session.verify();
 *   await payments.charge(order);
 * } catch (error) {
 *   if (error instanceof SessionRevokedError) console.warn("sesión revocada", context.requestId);
 *   throw error;
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#revocación-durante-una-petición
 */
export class SessionRevokedError extends ApiError {
  constructor() {
    super("SESSION_REVOKED", 401, "Session revoked");
    this.name = "SessionRevokedError";
  }
}

/** At most this many schema issues reach the client. */
const maxPublicIssues = 20;

/** Invalid input: a `400` whose schema messages reach the client as `issues`. */
class InvalidInputError extends ApiError {
  constructor(code: string, readonly issues: readonly { readonly path: string; readonly message: string }[]) {
    super(code, 400);
  }
}

function issuePath(path: unknown): string {
  if (!Array.isArray(path)) return "";
  return path.map((segment: unknown) => {
    const key = segment !== null && typeof segment === "object" && "key" in segment ? (segment as { key: unknown }).key : segment;
    return typeof key === "symbol" ? key.description ?? "" : String(key);
  }).join(".");
}

/** Only each issue's path keys and schema message are public; inputs and expectations are not. */
function publicIssues(issues: readonly unknown[]): { path: string; message: string }[] {
  const result: { path: string; message: string }[] = [];
  for (const issue of issues) {
    if (result.length >= maxPublicIssues) break;
    if (issue === null || typeof issue !== "object") continue;
    const { message, path } = issue as { message?: unknown; path?: unknown };
    if (typeof message === "string" && message) result.push({ path: issuePath(path), message });
  }
  return result;
}

/** Preserve public errors loaded through separate Vite module graphs; hide all others. */
export function normalizeServerError(error: unknown): ApiError {
  if (error instanceof SessionSecurityError) return new ApiError(error.code, 403);
  if (error instanceof Error && (error.name === "SessionSecurityError" || error.constructor.name === "SessionSecurityError")) {
    const code = (error as Error & { code?: unknown }).code;
    if (code === "INVALID_ORIGIN" || code === "INVALID_CSRF") return new ApiError(code, 403);
  }
  if (error instanceof Error && (error instanceof ApiError || error.name === "ApiError" || error.constructor.name === "ApiError" || error.name === "SessionRevokedError")) {
    const candidate = error as Error & { code?: unknown; status?: unknown };
    if (typeof candidate.code === "string" && candidate.code.length > 0
      && typeof candidate.status === "number" && Number.isInteger(candidate.status)
      && candidate.status >= 400 && candidate.status <= 599) {
      return error instanceof ApiError ? error : new ApiError(candidate.code, candidate.status);
    }
  }
  return new ApiError("INTERNAL_ERROR", 500);
}

/**
 * Observador de los fallos internos del servidor, con el ID de la petición. Su propio fallo no
 * cambia la respuesta.
 *
 * @example
 * ```ts
 * import type { ServerErrorObserver } from "@meekojs/meeko/server";
 *
 * export const onError: ServerErrorObserver = (error, requestId) => {
 *   console.error(`[${requestId}]`, error instanceof Error ? error.name : typeof error);
 * };
 * ```
 */
export type ServerErrorObserver = (error: unknown, requestId: string) => void;

function reportObserverFailure(error: unknown, observerError: unknown, requestId?: string): void {
  try {
    const label = requestId ? `Meeko server error observer failed (${requestId})` : "Meeko server error observer failed";
    // Error messages and custom properties may contain private server data.
    console.error(label, { original: error instanceof Error ? "Error" : typeof error, observer: observerError instanceof Error ? "Error" : typeof observerError });
  } catch { /* The fallback logger cannot change the original response. */ }
}

/** Observer failures cannot replace a response or escape as unhandled rejections. */
export function observeErrorCallback(error: unknown, observer?: (error: unknown) => void, requestId?: string): void {
  try { void Promise.resolve(observer?.(error)).catch((observerError: unknown) => reportObserverFailure(error, observerError, requestId)); }
  catch (observerError) { reportObserverFailure(error, observerError, requestId); }
}

/** Apply the same isolation to observers that also receive a request ID. */
export function observeServerError(error: unknown, requestId: string, observer?: ServerErrorObserver): void {
  observeErrorCallback(error, observer ? (failure) => observer(failure, requestId) : undefined, requestId);
}

/** Surface internal failures to the host while keeping observers out of the response path. */
export function reportServerError(error: unknown, requestId: string, observer?: ServerErrorObserver): void {
  if (normalizeServerError(error).status < 500) return;
  observeServerError(error, requestId, observer);
}

/**
 * Estados de éxito que un endpoint JSON puede elegir con `status` (desde `1.2`). `204` responde sin
 * cuerpo y el cliente generado resuelve `undefined`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { ApiSuccessStatus } from "@meekojs/meeko/server";
 *
 * const created: ApiSuccessStatus = 201;
 * ```
 */
export type ApiSuccessStatus = 200 | 201 | 202 | 204;

const successStatuses: ReadonlySet<unknown> = new Set<ApiSuccessStatus>([200, 201, 202, 204]);

/** What a JSON handler returns: nothing with `204`, the response schema's value otherwise. */
type ApiHandlerResult<R, T> = [T] extends [204] ? void | undefined : R extends Schema ? Output<R> : Response;

/**
 * Contrato de un endpoint de `server/api/<ruta>.<método>.ts`: schemas de entrada y respuesta,
 * autenticación, autorización y handler. Se declara con {@link defineApiRoute}.
 *
 * @typeParam P Schema de `params`.
 * @typeParam Q Schema de `query`.
 * @typeParam B Schema de `body`.
 * @typeParam R Schema de la respuesta.
 * @typeParam S Tipo de los servicios.
 * @typeParam L Valor de `locals` que recibe el handler; `undefined` sin `locals`.
 * @typeParam T Estado de éxito declarado con `status` (desde `1.2`).
 * @example
 * ```ts
 * import type { ApiRouteDefinition, Schema } from "@meekojs/meeko/server";
 *
 * type Health = ApiRouteDefinition<undefined, undefined, undefined, Schema<{ ok: boolean }>>;
 * ```
 */
export interface ApiRouteDefinition<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S = unknown, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus> {
  /** Segmentos dinámicos de la ruta, como cadenas obligatorias. */
  params?: P;
  /** Query string; sus campos aceptan cadenas o listas de cadenas. */
  query?: Q;
  /** Cuerpo JSON (`application/json`, hasta 1 MiB). */
  body?: B;
  /** Schema de la respuesta; obligatorio salvo con `contentType: "response"` o `status: 204`. */
  response?: R;
  /**
   * Estado HTTP de la respuesta correcta (desde `1.2`): `200` por defecto, `201` al crear, `202`
   * al aceptar trabajo diferido o `204` sin cuerpo. Con `200`, `201` y `202` la respuesta sigue
   * siendo JSON validado con `response`; con `204` el handler no devuelve nada y no se declara
   * `response`. No se combina con `contentType: "response"`. Debe ser un literal para que el
   * generador lo lea.
   */
  status?: T;
  /** `"required"` responde `401 UNAUTHENTICATED` sin sesión. */
  auth?: "required" | "optional";
  /**
   * `"required"` (desde `1.2`) responde `403 INVALID_ORIGIN` a las peticiones `POST`, `PUT`,
   * `PATCH` y `DELETE` cuyo `Origin` falta o no es el de la aplicación ni uno de
   * `SessionManager.allowedOrigins`, aunque no haya sesión; por ejemplo, un inicio de sesión.
   * Sin él, Origin sólo se comprueba en las mutaciones autenticadas con cookie.
   */
  origin?: "required";
  /** `"response"` deja que el handler devuelva su propio `Response`. */
  contentType?: "json" | "response";
  /** Devolver `false` responde `403 FORBIDDEN`. */
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  /**
   * Calcula un valor por petición que el handler recibe como `locals` (desde `1.2`), como el
   * usuario actual. Se ejecuta tras Origin, CSRF, `auth`, `authorize` y la validación de la
   * entrada, y justo antes del handler; un `ApiError` que lance (por ejemplo `401` o `403`) es la
   * respuesta. Declárelo antes de `handler` para que TypeScript infiera su tipo.
   */
  locals?: (context: RequestContext<S>) => L | Promise<L>;
  /**
   * Recibe la entrada validada, el contexto y `locals`; su resultado se valida con `response`. Con
   * `status: 204` no devuelve nada.
   */
  handler: (args: { params: OptionalOutput<P>; query: OptionalOutput<Q>; body: OptionalOutput<B>; context: RequestContext<S>; locals: L }) => Promise<ApiHandlerResult<R, T>> | ApiHandlerResult<R, T>;
}

/**
 * Declara un endpoint de API, el export por defecto de `server/api/<ruta>.<método>.ts`. El
 * servidor valida entrada, salida, sesión, autorización y CSRF; los clientes `api.*` se generan a
 * partir de sus schemas públicos.
 *
 * @param definition Schemas, guardas y handler.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/api/users/[id].get.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { userParams, userSchema } from "../../../shared/schemas/user.js";
 *
 * export default defineApiRoute({
 *   params: userParams,
 *   response: userSchema,
 *   handler: ({ params }) => ({ id: params.id, name: "Ada" }),
 * });
 * ```
 * Con `locals`, el handler recibe el usuario ya cargado:
 * ```ts
 * // server/api/orders/index.post.ts
 * import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
 * import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
 * import { createOrder, findUser } from "../../utils/store.js";
 *
 * export default defineApiRoute({
 *   auth: "required",
 *   body: newOrder,
 *   response: orderSchema,
 *   locals: async ({ session }) => {
 *     const user = await findUser((session.current?.data as { userId: string }).userId);
 *     if (!user) throw new ApiError("UNAUTHENTICATED", 401);
 *     return { user };
 *   },
 *   handler: ({ body, locals }) => createOrder(locals.user, body),
 * });
 * ```
 * Con `status`, una creación responde `201 Created` sin perder la validación ni el tipo del cliente:
 * ```ts
 * // server/api/orders/index.post.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { newOrder, orderSchema } from "../../../shared/schemas/order.js";
 * import { createOrder } from "../../utils/store.js";
 *
 * export default defineApiRoute({
 *   body: newOrder,
 *   response: orderSchema,
 *   status: 201,
 *   handler: ({ body }) => createOrder(body),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function defineApiRoute<P extends Schema | undefined = undefined, Q extends Schema | undefined = undefined, B extends Schema | undefined = undefined, R extends Schema | undefined = undefined, S = unknown, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>): ApiRouteDefinition<P, Q, B, R, S, L, T> {
  return definition;
}

/**
 * Contrato de un procedimiento de `server/rpc/`: schemas de entrada y salida, guardas y handler.
 * Se declara con {@link defineRpc}.
 *
 * @typeParam I Schema de la entrada.
 * @typeParam O Schema de la salida.
 * @typeParam S Tipo de los servicios.
 * @typeParam L Valor de `locals` que recibe el handler; `undefined` sin `locals`.
 * @example
 * ```ts
 * import type { RpcDefinition, Schema } from "@meekojs/meeko/server";
 *
 * type GetUser = RpcDefinition<Schema<{ id: string }>, Schema<{ id: string; name: string }>>;
 * ```
 */
export interface RpcDefinition<I extends Schema, O extends Schema, S = unknown, L = undefined> {
  /** Schema de la entrada JSON. */
  input: I;
  /** Schema de la salida. */
  output: O;
  /** `"required"` responde `401 UNAUTHENTICATED` sin sesión. */
  auth?: "required" | "optional";
  /**
   * `"required"` (desde `1.2`) responde `403 INVALID_ORIGIN` a toda llamada cuyo `Origin` falta o no
   * es el de la aplicación ni uno de `SessionManager.allowedOrigins`, aunque no haya sesión; por
   * ejemplo, un inicio de sesión. Sin él, Origin sólo se comprueba en las llamadas con sesión.
   */
  origin?: "required";
  /** Devolver `false` responde `403 FORBIDDEN`. */
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
  /**
   * Calcula un valor por petición que el handler recibe como `locals` (desde `1.2`), como el
   * usuario actual. Se ejecuta tras Origin, CSRF, `auth`, `authorize` y la validación de la
   * entrada, y justo antes del handler; un `ApiError` que lance (por ejemplo `401` o `403`) es la
   * respuesta. Declárelo antes de `handler` para que TypeScript infiera su tipo.
   */
  locals?: (context: RequestContext<S>) => L | Promise<L>;
  /** Recibe la entrada validada, el contexto y `locals`; su resultado se valida con `output`. */
  handler: (args: { input: Output<I>; context: RequestContext<S>; locals: L }) => Promise<Input<O> | Output<O>> | Input<O> | Output<O>;
}

/**
 * Declara un procedimiento RPC, el export por defecto de `server/rpc/<ruta>.ts`, que se llama con
 * `POST /_meeko/rpc/<ruta>` y desde `rpc.*`. Comprueba Origin y CSRF en las llamadas con sesión, y
 * Origin en todas con `origin: "required"`.
 *
 * @param definition Schemas, guardas y handler.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/rpc/users/get.ts
 * import { defineRpc } from "@meekojs/meeko/server";
 * import { userParams, userSchema } from "../../../shared/schemas/user.js";
 *
 * export default defineRpc({
 *   input: userParams,
 *   output: userSchema,
 *   handler: ({ input }) => ({ id: input.id, name: "Ada" }),
 * });
 * ```
 * Un inicio de sesión exige un Origin permitido aunque aún no haya sesión:
 * ```ts
 * // server/rpc/auth/login.ts
 * import { ApiError, defineRpc } from "@meekojs/meeko/server";
 * import { loginInput, loginOutput } from "../../../shared/schemas/auth.js";
 * import { verifyPassword } from "../../utils/users.js";
 *
 * export default defineRpc({
 *   input: loginInput,
 *   output: loginOutput,
 *   origin: "required",
 *   handler: async ({ input, context }) => {
 *     const user = await verifyPassword(input.email, input.password);
 *     if (!user) throw new ApiError("INVALID_CREDENTIALS", 401);
 *     await context.session.create({ userId: user.id }, { ttlMs: user.staff ? 12 * 3_600_000 : 30 * 86_400_000 });
 *     return { ok: true };
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export function defineRpc<I extends Schema, O extends Schema, S = unknown, L = undefined>(definition: RpcDefinition<I, O, S, L>): RpcDefinition<I, O, S, L> {
  return definition;
}

async function validate<S extends Schema>(schema: S, value: unknown, label: string): Promise<Output<S>> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    const code = `INVALID_${label.toUpperCase()}`;
    // A response that breaks its own schema is a server fault: no detail reaches the client.
    if (label === "response" || label === "output") throw new ApiError(code, 500);
    throw new InvalidInputError(code, publicIssues(result.issues));
  }
  return (result as { value: Output<S> }).value;
}

async function readJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("INVALID_JSON", 400);
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxBytes) throw new ApiError("BODY_TOO_LARGE", 413);
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ApiError("INVALID_JSON", 400); }
}

function queryObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}

type Guarded<S> = { auth?: "required" | "optional"; origin?: "required"; authorize?: (context: RequestContext<S>) => boolean | Promise<boolean> };

async function guard<S>(definition: Guarded<S>, context: RequestContext<S>, sessions: SessionManager, mutating?: boolean): Promise<void> {
  const request = context.request;
  // Anonymous mutations such as a sign-in opt in to the session's allowed-origin rule. SSR
  // clients send the request's own origin, so local dispatch passes.
  if (definition.origin === "required" && (mutating ?? !["GET", "HEAD", "OPTIONS"].includes(request.method))
    && !isAllowedOrigin(request, sessions.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
  sessions.assertMutationAllowed(request, context.session, mutating);
  if (definition.auth === "required" && !context.session.current) throw new ApiError("UNAUTHENTICATED", 401);
  if (definition.authorize && !(await definition.authorize(context))) throw new ApiError("FORBIDDEN", 403);
}

/**
 * Ejecuta un endpoint de API con sus guardas y validaciones y devuelve la respuesta JSON, o lanza
 * un `ApiError`. Es la pieza de bajo nivel de {@link dispatchApiRoute}, que además normaliza errores.
 * El orden es: Origin (`origin: "required"`), Origin y CSRF de la sesión, `auth`, `authorize`,
 * `params`, `query`, `body`, `locals`, handler y `response`. La respuesta usa el estado de
 * `status` (`200` por defecto); con `204`, sin cuerpo.
 *
 * @param definition Endpoint declarado con `defineApiRoute`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @param rawParams Parámetros de la ruta sin validar.
 * @returns La respuesta del endpoint.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_PARAMS`, `INVALID_QUERY`,
 * `INVALID_BODY`, `UNSUPPORTED_MEDIA_TYPE`, `BODY_TOO_LARGE`, `INVALID_RESPONSE`, `INVALID_RESPONSE_STATUS`
 * (un `status` no admitido o combinado con `contentType: "response"` o, con `204`, con `response`) o los de
 * `locals` y del handler.
 * @example
 * ```ts
 * import { executeApiRoute } from "@meekojs/meeko/server";
 * import userRoute from "./server/api/users/[id].get.js";
 *
 * const response = await executeApiRoute(userRoute, context, sessions, { id: "123" });
 * ```
 */
export async function executeApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, context: RequestContext<S>, sessions: SessionManager, rawParams: unknown = {}): Promise<Response> {
  // A misdeclared status is a server fault, reported before any input is read.
  const status = definition.status ?? 200;
  if (!successStatuses.has(status) || (definition.status !== undefined && definition.contentType === "response")
    || (status === 204 && definition.response)) throw new ApiError("INVALID_RESPONSE_STATUS", 500);
  await guard(definition, context, sessions);
  const params = definition.params ? await validate(definition.params, rawParams, "params") : undefined;
  const query = definition.query ? await validate(definition.query, queryObject(new URL(context.request.url)), "query") : undefined;
  const body = definition.body ? await validate(definition.body, await readJson(context.request), "body") : undefined;
  const locals = definition.locals ? await definition.locals(context) : undefined;
  const result: unknown = await definition.handler({ params: params as OptionalOutput<P>, query: query as OptionalOutput<Q>, body: body as OptionalOutput<B>, context, locals: locals as L });
  if (definition.contentType === "response") {
    if (!(result instanceof Response)) throw new ApiError("INVALID_RESPONSE", 500);
    return result;
  }
  if (status === 204) {
    if (result !== undefined) throw new ApiError("INVALID_RESPONSE", 500);
    return new Response(null, { status: 204 });
  }
  if (!definition.response) throw new ApiError("MISSING_RESPONSE_SCHEMA", 500);
  const output = await validate(definition.response, result, "response");
  return new Response(serializeJson(output), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

/**
 * Ejecuta un procedimiento RPC con sus guardas y validaciones y devuelve su salida validada. Es la
 * pieza de bajo nivel de {@link dispatchRpc}. El orden es: Origin (`origin: "required"`), Origin y
 * CSRF de la sesión, `auth`, `authorize`, `input`, `locals`, handler y `output`.
 *
 * @param definition Procedimiento declarado con `defineRpc`.
 * @param rawInput Entrada sin validar.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @returns La salida validada.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`, `INVALID_OUTPUT` o
 * los de `locals` y del handler.
 * @example
 * ```ts
 * import { executeRpc } from "@meekojs/meeko/server";
 * import getUser from "./server/rpc/users/get.js";
 *
 * const user = await executeRpc(getUser, { id: "123" }, context, sessions);
 * ```
 */
export async function executeRpc<I extends Schema, O extends Schema, S, L = undefined>(definition: RpcDefinition<I, O, S, L>, rawInput: unknown, context: RequestContext<S>, sessions: SessionManager): Promise<Output<O>> {
  await guard(definition, context, sessions, true);
  const input = await validate(definition.input, rawInput, "input");
  const locals = definition.locals ? await definition.locals(context) : undefined;
  const result = await definition.handler({ input, context, locals: locals as L });
  const output = await validate(definition.output, result, "output");
  serializeJson(output);
  return output;
}

/**
 * Convierte un error en la respuesta JSON pública `{ code, status, requestId }` con la cabecera
 * `x-request-id`. Un `ApiError` conserva su código y estado; cualquier otro error es
 * `INTERNAL_ERROR`/`500`, sin su mensaje. Desde `1.2`, la entrada que no supera su schema
 * (`INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY`, `INVALID_INPUT`) añade
 * `issues: [{ path, message }]`, con como mucho 20 mensajes del schema.
 *
 * @param error Error capturado.
 * @param requestId ID de la petición.
 * @returns La respuesta de error.
 * @example
 * ```ts
 * import { ApiError, errorResponse } from "@meekojs/meeko/server";
 *
 * const response = errorResponse(new ApiError("NOT_FOUND", 404), crypto.randomUUID());
 * // 404 {"code":"NOT_FOUND","status":404,"requestId":"..."}
 * ```
 */
export function errorResponse(error: unknown, requestId: string): Response {
  const known = normalizeServerError(error);
  const issues = known instanceof InvalidInputError && known.issues.length ? known.issues : undefined;
  return new Response(serializeJson({ code: known.code, status: known.status, requestId, ...(issues ? { issues } : {}) }), { status: known.status, headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId } });
}

function finish(response: Response, context: RequestContext): Response {
  // Fetch-created responses such as Response.redirect have immutable headers.
  // Wrap the response to preserve its status, body, and headers before adding
  // request metadata and session changes.
  const finished = new Response(response.body, response);
  finished.headers.set("x-request-id", context.requestId);
  if (context.session.cookieHeader) finished.headers.append("set-cookie", context.session.cookieHeader);
  if (context.session.current) finished.headers.set("x-meeko-csrf-token", context.session.current.csrfToken);
  else if (context.session.cookieHeader) finished.headers.set("x-meeko-csrf-token", "");
  return finished;
}

/**
 * Atiende una petición de API para un host propio: ejecuta el endpoint, normaliza los errores en
 * `{ code, status, requestId }`, informa los fallos 5xx a `onError` y añade `x-request-id`, la
 * cookie de sesión y el token CSRF. Nunca rechaza.
 *
 * @param definition Endpoint declarado con `defineApiRoute`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones.
 * @param params Parámetros de la ruta sin validar.
 * @param onError Observador de los fallos internos.
 * @returns La respuesta final.
 * @example
 * ```ts
 * import { dispatchApiRoute } from "@meekojs/meeko/server";
 * import userRoute from "./server/api/users/[id].get.js";
 *
 * const response = await dispatchApiRoute(userRoute, context, sessions, { id: "123" }, (error, id) => console.error(id, error));
 * ```
 */
export async function dispatchApiRoute<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L = undefined, T extends ApiSuccessStatus = ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, context: RequestContext<S>, sessions: SessionManager, params: unknown = {}, onError?: ServerErrorObserver): Promise<Response> {
  try { return finish(await executeApiRoute(definition, context, sessions, params), context); }
  catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}

/**
 * Atiende una petición RPC para un host propio: exige `POST` con JSON, ejecuta el procedimiento,
 * normaliza los errores, informa los fallos 5xx a `onError` y añade `x-request-id`, la cookie de
 * sesión y el token CSRF. Nunca rechaza.
 *
 * @param definition Procedimiento declarado con `defineRpc`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones.
 * @param onError Observador de los fallos internos.
 * @returns La respuesta final.
 * @example
 * ```ts
 * import { dispatchRpc } from "@meekojs/meeko/server";
 * import getUser from "./server/rpc/users/get.js";
 *
 * const response = await dispatchRpc(getUser, context, sessions);
 * ```
 */
export async function dispatchRpc<I extends Schema, O extends Schema, S, L = undefined>(definition: RpcDefinition<I, O, S, L>, context: RequestContext<S>, sessions: SessionManager, onError?: ServerErrorObserver): Promise<Response> {
  try {
    if (context.request.method !== "POST") throw new ApiError("METHOD_NOT_ALLOWED", 405);
    const output = await executeRpc(definition, await readJson(context.request), context, sessions);
    return finish(new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } }), context);
  } catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}
