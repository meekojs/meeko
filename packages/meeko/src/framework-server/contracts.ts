import { serializeJson } from "../server.js";
import type { RequestContext } from "./context.js";
import { echoValues, formEncoding, formFlashCookie, formObject, formReturnPath, issueRoot, planFormConversion, sameOriginPath, seeOther } from "./forms.js";
import type { FormFieldValue, ParsedForm } from "./forms.js";
import { countRateLimit, rateLimitKey, rateLimitSettings, rateLimitSubject, retryAfterSeconds } from "./rate-limit.js";
import type { RateLimitOptions } from "./rate-limit.js";
import { isAllowedOrigin, SessionSecurityError, settleSessionOrigin, type SessionManager } from "./sessions.js";

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
  /** Interfaz Standard Schema v1: `validate` devuelve el valor de salida o la lista de `issues`. */
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => { value: O; issues?: undefined } | { issues: readonly unknown[] } | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type Input<S> = S extends Schema<infer I, unknown> ? I : never;
type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type OptionalOutput<S> = S extends Schema ? Output<S> : undefined;

/** Marks the ApiErrors of every copy of Meeko: only theirs carry public `issues` through {@link normalizeServerError}. */
const apiErrorMark = Symbol.for("meeko.apiError");

/**
 * Error público de API, RPC, Socket y loaders: conserva `code` y `status` en la respuesta, que
 * añade `requestId`. Cualquier otro error se responde como `INTERNAL_ERROR`/`500` sin exponer su
 * mensaje.
 *
 * Desde `1.5`, el tercer argumento también puede ser `{ message, issues }`: `issues` son mensajes
 * públicos por campo, con la misma forma `{ path, message }` que los de un `400` de validación, y
 * viajan en la respuesta de API y RPC (como mucho 20, y sólo con un estado `4xx`). En el cliente
 * llegan en `ClientError.issues`, y `useForm` los lleva a cada campo. `message` sigue siendo
 * interno.
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
 * Un conflicto que pertenece a un campo:
 * ```ts
 * if (await emailTaken(body.email)) {
 *   throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#api-y-rpc
 */
export class ApiError extends Error {
  /**
   * Mensajes públicos por campo (desde `1.5`), o `undefined`. Se envían con un estado `4xx`.
   * @since 1.5.0
   */
  declare public readonly issues?: readonly ApiErrorIssue[];

  /**
   * @param code Código público, como `USER_NOT_FOUND`.
   * @param status Estado HTTP entre 400 y 599.
   * @param message Mensaje interno; no se envía al cliente. Por defecto, el código. Desde `1.5`,
   * también `{ message, issues }`, con los mensajes públicos por campo.
   * @throws {TypeError} Si un issue no tiene `path` y `message` de texto.
   */
  constructor(public readonly code: string, public readonly status: number, message: string | ApiErrorOptions = code) {
    const options = typeof message === "string" ? { message } : message;
    super(options.message ?? code);
    this.name = "ApiError";
    Object.defineProperty(this, apiErrorMark, { value: true });
    if (options.issues !== undefined) this.issues = checkedIssues(options.issues);
  }
}

/**
 * Un mensaje público de un campo, como los `issues` de un `400` de validación: `path` son las claves
 * unidas con `.` (`"email"`, `"items.0.name"`), o `""` para el formulario completo.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import type { ApiErrorIssue } from "@meekojs/meeko/server";
 * const issue: ApiErrorIssue = { path: "email", message: "Ese correo ya tiene una cuenta." };
 * ```
 */
export interface ApiErrorIssue {
  /** Ruta del campo, con las claves unidas con `.`, o `""` para el formulario completo. */
  readonly path: string;
  /** Mensaje público para el usuario. */
  readonly message: string;
}

/**
 * Tercer argumento de {@link ApiError} con opciones.
 *
 * @since 1.5.0
 * @example
 * ```ts
 * import { ApiError } from "@meekojs/meeko/server";
 * import type { ApiErrorOptions } from "@meekojs/meeko/server";
 * const options: ApiErrorOptions = { message: "duplicate key users_email", issues: [{ path: "email", message: "Ese correo ya existe." }] };
 * throw new ApiError("EMAIL_TAKEN", 409, options);
 * ```
 */
export interface ApiErrorOptions {
  /** Mensaje interno; no se envía al cliente. Por defecto, el código. */
  readonly message?: string;
  /** Mensajes públicos por campo, que el cliente recibe en `ClientError.issues`. */
  readonly issues?: readonly ApiErrorIssue[];
}

function checkedIssues(issues: unknown): readonly ApiErrorIssue[] {
  if (!Array.isArray(issues)) throw new TypeError("ApiError issues must be an array of { path, message }");
  return Object.freeze(issues.map((issue: unknown) => {
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
    if (typeof path !== "string" || typeof message !== "string" || !message) throw new TypeError("Each ApiError issue needs a string path and a nonempty string message");
    return Object.freeze({ path, message });
  }));
}

/** The issues of an `ApiError` that reach the client: only with a 4xx status, at most 20. */
function sentIssues(error: ApiError): readonly ApiErrorIssue[] | undefined {
  if (error.status >= 500 || !error.issues?.length) return undefined;
  return error.issues.slice(0, maxPublicIssues);
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
  constructor(code: string, issues: readonly ApiErrorIssue[]) {
    super(code, 400, { issues });
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
      if (error instanceof ApiError) return error;
      // An ApiError of another module graph keeps its public issues, checked again here. Another
      // error with its name (an SDK's, or a service's issues) keeps only its code and status.
      const own = (candidate as unknown as Record<symbol, unknown>)[apiErrorMark] === true;
      let issues: readonly ApiErrorIssue[] | undefined;
      try { issues = !own || (candidate as { issues?: unknown }).issues === undefined ? undefined : checkedIssues((candidate as { issues?: unknown }).issues); }
      catch { issues = undefined; }
      return new ApiError(candidate.code, candidate.status, issues ? { issues } : candidate.code);
    }
  }
  return new ApiError("INTERNAL_ERROR", 500);
}

/**
 * Qué fallo del proceso recibe un {@link ServerErrorObserver} como tercer argumento: una promesa
 * rechazada sin manejar o una excepción no capturada, fuera del flujo de una petición. Los fallos
 * de las peticiones no lo llevan.
 *
 * @since 1.3.0
 * @example
 * ```ts
 * import type { ServerErrorInfo } from "@meekojs/meeko/server";
 *
 * function describe(info: ServerErrorInfo | undefined): string {
 *   if (!info) return "petición";
 *   return `${info.kind}${info.inRequest ? " durante una petición" : ""}`;
 * }
 * ```
 */
export interface ServerErrorInfo {
  /** `"unhandledRejection"`: una promesa rechazada sin manejar; `"uncaughtException"`: una excepción no capturada. */
  readonly kind: "unhandledRejection" | "uncaughtException";
  /**
   * `true` si el fallo se produjo dentro del trabajo asíncrono de una petición y `requestId` es el
   * de esa petición; `false` si el ID es nuevo. Depende de que el runtime conserve el contexto
   * asíncrono hasta el evento (véase la documentación de errores).
   */
  readonly inRequest: boolean;
}

/**
 * Observador de los fallos internos del servidor, con el ID de la petición. Su propio fallo no
 * cambia la respuesta. Desde `1.3`, los fallos del proceso (promesas rechazadas sin manejar y
 * excepciones no capturadas) llegan con un tercer argumento, {@link ServerErrorInfo}.
 *
 * @example
 * ```ts
 * import type { ServerErrorObserver } from "@meekojs/meeko/server";
 *
 * export const onError: ServerErrorObserver = (error, requestId, info) => {
 *   const where = info ? info.kind : "request";
 *   console.error(`[${where} ${requestId}]`, error instanceof Error ? error.name : typeof error);
 * };
 * ```
 */
export type ServerErrorObserver = (error: unknown, requestId: string, info?: ServerErrorInfo) => void;

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
export function observeServerError(error: unknown, requestId: string, observer?: ServerErrorObserver, info?: ServerErrorInfo): void {
  observeErrorCallback(error, observer ? (failure) => info ? observer(failure, requestId, info) : observer(failure, requestId) : undefined, requestId);
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
/** What `form.redirect` receives: the validated response, `undefined` with `204`, or the handler's `Response`. */
type ApiFormResult<R, T> = [T] extends [204] ? undefined : R extends Schema ? Output<R> : Response;

/**
 * Opciones de un endpoint que acepta formularios HTML nativos con `form` (desde `1.7`): un
 * `<form method="post">` que funciona sin JavaScript, enviado como
 * `application/x-www-form-urlencoded` o `multipart/form-data`.
 *
 * @typeParam Result Lo que recibe `redirect`: la respuesta validada con `response`, `undefined` con
 * `status: 204` o el `Response` del handler con `contentType: "response"`.
 * @typeParam S Tipo de los servicios.
 * @since 1.7.0
 * @example
 * ```ts
 * // server/api/feedback.post.ts
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback.js";
 * import { saveFeedback } from "../utils/feedback.js";
 *
 * export default defineApiRoute({
 *   body: feedbackInput,
 *   response: feedbackSaved,
 *   // Tras un error, el comentario vuelve a la página; ningún otro valor.
 *   form: { redirect: (saved) => `/gracias?id=${saved.id}`, echo: ["comment"] },
 *   handler: ({ body }) => saveFeedback(body),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#formularios-sin-javascript-form
 */
export interface ApiFormOptions<Result = unknown, S = unknown> {
  /**
   * Ruta de esta aplicación a la que vuelve un envío correcto con `303 See Other`, como
   * `/gracias`. Sin ella, la del campo `return` del formulario, la de `Referer` o `/`. Una ruta de
   * otro origen, con `//`, `\` o un esquema se sustituye por `/`.
   */
  readonly redirect?: (result: Result, context: RequestContext<S>) => string | Promise<string>;
  /** Tamaño máximo del cuerpo en bytes; por defecto 1 MiB, como el JSON. Por encima, `BODY_TOO_LARGE`. */
  readonly maxBytes?: number;
  /**
   * Con `true`, un `multipart/form-data` puede traer archivos, que llegan al schema de `body` como
   * `File`. Sin él, un archivo responde `FILES_NOT_ALLOWED` (`400`).
   */
  readonly files?: boolean;
  /**
   * Campos cuyo valor enviado vuelve a la página tras un envío con errores, para que el SSR los
   * pinte de nuevo, como `["name", "email"]`. Por defecto ninguno: sólo vuelven el código y los
   * `issues`, y los campos muestran `initial`. Los valores viajan en una cookie de un solo uso y en
   * el HTML de la página, así que no incluyas contraseñas, números de tarjeta ni otros datos
   * sensibles; aun así, los nombres que parecen credenciales (`password`, `token`, `secret`, `cvc`…)
   * nunca se devuelven. Sólo vuelven texto, números y booleanos, nunca archivos.
   */
  readonly echo?: readonly string[];
}

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
  /** Cuerpo JSON (`application/json`, hasta 1 MiB) y, con `form` (desde `1.7`), el de un formulario nativo. */
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
   * Sin él, Origin se comprueba en las mutaciones autenticadas con cookie y, desde `1.2`, cuando el
   * handler llama a `context.session.create()`.
   *
   * `"none"` (desde `1.2`, **inseguro**) permite que `session.create()` cree una sesión sin un
   * `Origin` permitido, para clientes que no lo envían, como una app nativa. Expone esa ruta al
   * *login CSRF*: úsela sólo con otra prueba de que la petición no viene de otra web.
   */
  origin?: "required" | "none";
  /**
   * Límite de peticiones (desde `1.2`), como `{ limit: 5, window: "5m" }`: por encima responde
   * `429 RATE_LIMITED` con `Retry-After`, tras Origin y CSRF y antes de `auth`, `authorize`, la
   * entrada y el handler. Cuenta en el store de sesiones (Redis entre instancias) y, si el store
   * falla, la petición se rechaza.
   */
  rateLimit?: RateLimitOptions<S>;
  /** `"response"` deja que el handler devuelva su propio `Response`. */
  contentType?: "json" | "response";
  /**
   * Acepta también formularios HTML nativos (desde `1.7`): `application/x-www-form-urlencoded` y
   * `multipart/form-data`, validados con el mismo schema de `body`. Un envío correcto responde
   * `303 See Other` a `redirect`, al campo `return` o a la página de `Referer`; un error vuelve a
   * esa página con `303` y su estado, que `useForm({ action })` pinta en el SSR. Exige siempre un
   * `Origin` permitido. Sin `form`, esos tipos responden `415 UNSUPPORTED_MEDIA_TYPE`.
   */
  form?: true | ApiFormOptions<ApiFormResult<R, T>, S>;
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
   * ejemplo, un inicio de sesión. Sin él, Origin se comprueba en las llamadas con sesión y, desde
   * `1.2`, cuando el handler llama a `context.session.create()`.
   *
   * `"none"` (desde `1.2`, **inseguro**) permite que `session.create()` cree una sesión sin un
   * `Origin` permitido, para clientes que no lo envían, como una app nativa. Expone ese
   * procedimiento al *login CSRF*: úselo sólo con otra prueba de que la llamada no viene de otra web.
   */
  origin?: "required" | "none";
  /**
   * Límite de llamadas (desde `1.2`), como `{ limit: 5, window: "5m" }`: por encima responde
   * `429 RATE_LIMITED` con `Retry-After`, tras Origin y CSRF y antes de `auth`, `authorize`, la
   * entrada y el handler. Cuenta en el store de sesiones (Redis entre instancias) y, si el store
   * falla, la llamada se rechaza.
   */
  rateLimit?: RateLimitOptions<S>;
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
 * Un inicio de sesión exige un Origin permitido aunque aún no haya sesión, y limita los intentos:
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
 *   rateLimit: { limit: 5, window: "5m" },
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

const defaultMaxBodyBytes = 1024 * 1024;

/** The body as bytes, or `undefined` without one; more than `maxBytes` is `413 BODY_TOO_LARGE`. */
async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const reader = request.body?.getReader();
  if (!reader) return undefined;
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
  return bytes;
}

async function readJson(request: Request, maxBytes = defaultMaxBodyBytes): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiError("UNSUPPORTED_MEDIA_TYPE", 415);
  const bytes = await readBounded(request, maxBytes);
  if (!bytes) throw new ApiError("INVALID_JSON", 400);
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new ApiError("INVALID_JSON", 400); }
}

/** The fields of a native form, with `_csrf` and `return` apart. */
async function readForm(request: Request, encoding: "urlencoded" | "multipart", maxBytes: number, files: boolean): Promise<ParsedForm> {
  // A declared length over the limit is refused before reading anything.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiError("BODY_TOO_LARGE", 413);
  const bytes = await readBounded(request, maxBytes) ?? new Uint8Array();
  let entries: Iterable<[string, FormDataEntryValue]>;
  if (encoding === "urlencoded") {
    entries = new URLSearchParams(new TextDecoder().decode(bytes));
  } else {
    try { entries = await new Response(bytes, { headers: { "content-type": request.headers.get("content-type")! } }).formData() as unknown as Iterable<[string, FormDataEntryValue]>; }
    catch { throw new ApiError("INVALID_FORM", 400); }
  }
  return formObject(entries, files);
}

/**
 * Validates a form with the route's `body` schema: first its text; if the schema rejects some
 * fields, once more with the typed reading of those fields (`convertFormValue`). A field whose
 * conversion still fails keeps the messages of its text.
 */
async function validateForm(schema: Schema, fields: Record<string, FormFieldValue>): Promise<{ value: unknown } | { issues: ApiErrorIssue[]; echo: Record<string, unknown> }> {
  const pending = schema["~standard"].validate(fields);
  // An asynchronous schema may have side effects (a lookup, a uniqueness check): it runs once, so
  // its form fields get no second attempt with the typed reading of their text.
  const asynchronous = typeof (pending as Partial<PromiseLike<unknown>>).then === "function";
  const first = await pending;
  if (!("issues" in first && first.issues)) return { value: (first as { value: unknown }).value };
  const firstIssues = publicIssues(first.issues);
  const plan = asynchronous ? undefined : planFormConversion(fields, first.issues.map((issue) => issueRoot(issuePath((issue as { path?: unknown } | null)?.path))));
  if (!plan) return { issues: firstIssues, echo: fields };
  const second = await schema["~standard"].validate(plan.value);
  if (!("issues" in second && second.issues)) return { value: (second as { value: unknown }).value };
  const failing = new Set(second.issues.map((issue) => issueRoot(issuePath((issue as { path?: unknown } | null)?.path))));
  const issues = [
    ...publicIssues(second.issues).filter((issue) => !plan.converted.has(issueRoot(issue.path))),
    ...firstIssues.filter((issue) => plan.converted.has(issueRoot(issue.path)) && failing.has(issueRoot(issue.path))),
  ].slice(0, maxPublicIssues);
  const echo: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) echo[key] = plan.converted.has(key) && !failing.has(key) ? plan.value[key] : value;
  return { issues, echo };
}

function queryObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    const previous = result[key];
    result[key] = previous === undefined ? value : Array.isArray(previous) ? [...previous, value] : [previous, value];
  }
  return result;
}

type Guarded<S> = {
  auth?: "required" | "optional";
  origin?: "required" | "none";
  rateLimit?: RateLimitOptions<S>;
  authorize?: (context: RequestContext<S>) => boolean | Promise<boolean>;
};

/** Too many requests: `429 RATE_LIMITED`, with the seconds to wait in `Retry-After`. */
class RateLimitedError extends ApiError {
  constructor(readonly retryAfter: number) { super("RATE_LIMITED", 429); }
}

/** Counter route of a request: the dispatcher's route pattern, or its method and pathname. */
const routeIds = new WeakMap<object, string>();

/** Names the route of a request for its rate limit, so `/users/1` and `/users/2` share a counter. */
export function setRateLimitRoute(context: RequestContext<any>, route: string): void { routeIds.set(context, route); }

async function enforceRateLimit<S>(options: RateLimitOptions<S>, context: RequestContext<S>, sessions: SessionManager): Promise<void> {
  // A misdeclared limit is a server fault, reported before the request does anything.
  const settings = rateLimitSettings(options as RateLimitOptions<never>);
  if (!settings) throw new ApiError("INVALID_RATE_LIMIT", 500);
  const subject = await rateLimitSubject(options, context);
  if (subject === undefined) throw new ApiError("INVALID_RATE_LIMIT", 500);
  const request = context.request;
  const route = routeIds.get(context) ?? `${request.method} ${new URL(request.url).pathname}`;
  const key = await rateLimitKey(route, subject);
  // Stores without their own counter (and custom managers) count in this instance's memory.
  const counter = typeof (sessions as Partial<SessionManager>).rateLimit === "function"
    ? sessions.rateLimit(key, settings.windowMs)
    : countRateLimit(undefined, key, settings.windowMs, false);
  const hit = await counter;
  if (hit.count > settings.limit) throw new RateLimitedError(retryAfterSeconds(hit.resetInMs));
}

/** The request with the CSRF token of a native form's `_csrf` field in `x-meeko-csrf`, for the session check. */
function withCsrfHeader(request: Request, token: string | undefined): Request {
  if (!token || request.headers.has("x-meeko-csrf")) return request;
  const headers = new Headers(request.headers);
  headers.set("x-meeko-csrf", token);
  return new Request(request.url, { method: request.method, headers });
}

async function guard<S>(definition: Guarded<S>, context: RequestContext<S>, sessions: SessionManager, mutating?: boolean, formCsrf?: string, rateLimited = false): Promise<void> {
  const request = context.request;
  // Anonymous mutations such as a sign-in opt in to the session's allowed-origin rule. SSR
  // clients send the request's own origin, so local dispatch passes.
  if (definition.origin === "required" && (mutating ?? !["GET", "HEAD", "OPTIONS"].includes(request.method))) {
    if (!isAllowedOrigin(request, sessions.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
    context.session[settleSessionOrigin]?.("verified");
  }
  // An explicit, documented opt-out: session.create() then skips its login CSRF check.
  if (definition.origin === "none") context.session[settleSessionOrigin]?.("exempt");
  sessions.assertMutationAllowed(withCsrfHeader(request, formCsrf), context.session, mutating);
  // Before auth and authorize: a flood of anonymous requests is limited too. A native form counted
  // it already, before reading its body.
  if (definition.rateLimit && !rateLimited) await enforceRateLimit(definition.rateLimit, context, sessions);
  if (definition.auth === "required" && !context.session.current) throw new ApiError("UNAUTHENTICATED", 401);
  if (definition.authorize && !(await definition.authorize(context))) throw new ApiError("FORBIDDEN", 403);
}

/** A misdeclared status is a server fault, reported before any input is read. */
function checkedStatus(definition: { readonly status?: unknown; readonly contentType?: unknown; readonly response?: unknown }): ApiSuccessStatus {
  const status = (definition.status ?? 200) as ApiSuccessStatus;
  if (!successStatuses.has(status) || (definition.status !== undefined && definition.contentType === "response")
    || (status === 204 && definition.response)) throw new ApiError("INVALID_RESPONSE_STATUS", 500);
  return status;
}

/**
 * Ejecuta un endpoint de API con sus guardas y validaciones y devuelve la respuesta JSON, o lanza
 * un `ApiError`. Es la pieza de bajo nivel de {@link dispatchApiRoute}, que además normaliza errores.
 * El orden es: Origin (`origin: "required"`), Origin y CSRF de la sesión, `rateLimit`, `auth`,
 * `authorize`, `params`, `query`, `body`, `locals`, handler y `response`. La respuesta usa el
 * estado de `status` (`200` por defecto); con `204`, sin cuerpo.
 *
 * @param definition Endpoint declarado con `defineApiRoute`.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @param rawParams Parámetros de la ruta sin validar.
 * @returns La respuesta del endpoint.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_PARAMS`, `INVALID_QUERY`,
 * `INVALID_BODY`, `UNSUPPORTED_MEDIA_TYPE`, `BODY_TOO_LARGE`, `INVALID_RATE_LIMIT`, `INVALID_RESPONSE`, `INVALID_RESPONSE_STATUS`
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
  const status = checkedStatus(definition);
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
 * CSRF de la sesión, `rateLimit`, `auth`, `authorize`, `input`, `locals`, handler y `output`.
 *
 * @param definition Procedimiento declarado con `defineRpc`.
 * @param rawInput Entrada sin validar.
 * @param context Contexto de la petición.
 * @param sessions Gestor de sesiones, para Origin y CSRF.
 * @returns La salida validada.
 * @throws {ApiError} Con `INVALID_ORIGIN`, `RATE_LIMITED`, `UNAUTHENTICATED`, `FORBIDDEN`, `INVALID_INPUT`,
 * `INVALID_RATE_LIMIT`, `INVALID_OUTPUT` o los de `locals` y del handler.
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
 * `issues: [{ path, message }]`, con como mucho 20 mensajes del schema, y `429 RATE_LIMITED`
 * lleva `Retry-After` con los segundos que faltan.
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
  const issues = sentIssues(known);
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8", "x-request-id": requestId };
  if (known instanceof RateLimitedError) headers["retry-after"] = String(known.retryAfter);
  return new Response(serializeJson({ code: known.code, status: known.status, requestId, ...(issues ? { issues } : {}) }), { status: known.status, headers });
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
 * cookie de sesión y el token CSRF. Nunca rechaza. Desde `1.7`, si el endpoint declara `form` y
 * la petición es un formulario nativo, responde `303 See Other` con el resultado en una cookie de
 * un solo uso (salvo `403` por Origin o CSRF); `executeApiRoute` sigue aceptando sólo JSON.
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
  const encoding = definition.form ? formEncoding(context.request) : undefined;
  if (encoding) return dispatchApiForm(definition, encoding, context, sessions, params, onError);
  try { return finish(await executeApiRoute(definition, context, sessions, params), context); }
  catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}

/**
 * A native form against an API route with `form`: the same guards, schemas and handler as JSON,
 * but the answer is a `303 See Other` with a single-use cookie for the page it returns to. Only a
 * foreign Origin or a failed CSRF check answers `403` directly: that request is not this site's.
 */
async function dispatchApiForm<P extends Schema | undefined, Q extends Schema | undefined, B extends Schema | undefined, R extends Schema | undefined, S, L, T extends ApiSuccessStatus>(definition: ApiRouteDefinition<P, Q, B, R, S, L, T>, encoding: "urlencoded" | "multipart", context: RequestContext<S>, sessions: SessionManager, rawParams: unknown, onError?: ServerErrorObserver): Promise<Response> {
  const request = context.request;
  const url = new URL(request.url);
  const options: ApiFormOptions<unknown, S> = definition.form === true || !definition.form ? {} : definition.form as ApiFormOptions<unknown, S>;
  let parsed: ParsedForm | undefined;
  let echo: Record<string, unknown> | undefined;
  const echoNames: readonly string[] = Array.isArray(options.echo) ? options.echo.filter((name): name is string => typeof name === "string") : [];
  try {
    const status = checkedStatus(definition);
    // A form needs no preflight, so any site can send one: every native submission needs this
    // site's Origin, which browsers send with each POST, before its body is read.
    if (!isAllowedOrigin(request, sessions.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
    const maxBytes = options.maxBytes ?? defaultMaxBodyBytes;
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new ApiError("INVALID_FORM_OPTIONS", 500);
    if (options.echo !== undefined && !(Array.isArray(options.echo) && options.echo.every((name) => typeof name === "string"))) throw new ApiError("INVALID_FORM_OPTIONS", 500);
    // A flood of submissions is limited before any body is read; the CSRF token is in the body.
    if (definition.rateLimit) await enforceRateLimit(definition.rateLimit, context, sessions);
    parsed = await readForm(request, encoding, maxBytes, options.files === true);
    echo = parsed.fields;
    // Read after `return`, so the error goes back to the page of the form.
    if (parsed.rejectedFile) throw new ApiError("FILES_NOT_ALLOWED", 400);
    await guard(definition, context, sessions, undefined, parsed.csrf, true);
    const params = definition.params ? await validate(definition.params, rawParams, "params") : undefined;
    const query = definition.query ? await validate(definition.query, queryObject(url), "query") : undefined;
    let body: unknown;
    if (definition.body) {
      const checked = await validateForm(definition.body, parsed.fields);
      if ("issues" in checked) { echo = checked.echo; throw new InvalidInputError("INVALID_BODY", checked.issues); }
      body = checked.value;
    }
    const locals = definition.locals ? await definition.locals(context) : undefined;
    const result: unknown = await definition.handler({ params: params as OptionalOutput<P>, query: query as OptionalOutput<Q>, body: body as OptionalOutput<B>, context, locals: locals as L });
    let output: unknown;
    if (definition.contentType === "response") {
      if (!(result instanceof Response)) throw new ApiError("INVALID_RESPONSE", 500);
      // Without `redirect`, the handler's own response is the answer.
      if (!options.redirect) return finish(result, context);
      output = result;
    } else if (status === 204) {
      if (result !== undefined) throw new ApiError("INVALID_RESPONSE", 500);
    } else {
      if (!definition.response) throw new ApiError("MISSING_RESPONSE_SCHEMA", 500);
      output = await validate(definition.response, result, "response");
    }
    const location = options.redirect
      ? sameOriginPath(await options.redirect(output, context), url.origin)
      : formReturnPath(parsed.returnTo, request);
    return finish(seeOther(location, formFlashCookie(request, { action: url.pathname, ok: true }, location)), context);
  } catch (error) {
    reportServerError(error, context.requestId, onError);
    const known = normalizeServerError(error);
    if (known.code === "INVALID_ORIGIN" || known.code === "INVALID_CSRF") return finish(errorResponse(error, context.requestId), context);
    const location = formReturnPath(parsed?.returnTo, request);
    const issues = sentIssues(known);
    const flash = {
      action: url.pathname, ok: false, code: known.code, status: known.status, requestId: context.requestId,
      ...(issues ? { issues } : {}),
      // Only the fields the route lists in `form.echo` travel back; by default, none.
      ...(echo && echoNames.length ? { values: echoValues(echo, echoNames) } : {}),
    };
    return finish(seeOther(location, formFlashCookie(request, flash, location)), context);
  }
}

/**
 * Atiende una petición RPC para un host propio: exige `POST` con JSON (otro método responde `405`
 * con `Allow: POST`), ejecuta el procedimiento, normaliza los errores, informa los fallos 5xx a
 * `onError` y añade `x-request-id`, la cookie de sesión y el token CSRF. Nunca rechaza.
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
    if (context.request.method !== "POST") {
      const response = errorResponse(new ApiError("METHOD_NOT_ALLOWED", 405), context.requestId);
      response.headers.set("allow", "POST");
      return finish(response, context);
    }
    const output = await executeRpc(definition, await readJson(context.request), context, sessions);
    return finish(new Response(serializeJson(output), { headers: { "content-type": "application/json; charset=utf-8" } }), context);
  } catch (error) { reportServerError(error, context.requestId, onError); return finish(errorResponse(error, context.requestId), context); }
}
