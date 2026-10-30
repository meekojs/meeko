
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
export function sentIssues(error: ApiError): readonly ApiErrorIssue[] | undefined {
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
export const maxPublicIssues = 20;

/** Invalid input: a `400` whose schema messages reach the client as `issues`. */
export class InvalidInputError extends ApiError {
  constructor(code: string, issues: readonly ApiErrorIssue[]) {
    super(code, 400, { issues });
  }
}

export function issuePath(path: unknown): string {
  if (!Array.isArray(path)) return "";
  return path.map((segment: unknown) => {
    const key = segment !== null && typeof segment === "object" && "key" in segment ? (segment as { key: unknown }).key : segment;
    return typeof key === "symbol" ? key.description ?? "" : String(key);
  }).join(".");
}

/** Only each issue's path keys and schema message are public; inputs and expectations are not. */
export function publicIssues(issues: readonly unknown[]): { path: string; message: string }[] {
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
 * Una mutación autenticada no superó la comprobación de Origin o de CSRF. Las respuestas de API y
 * RPC la convierten en `403` con su código.
 *
 * @example
 * ```ts
 * import { SessionSecurityError } from "@meekojs/meeko/server";
 *
 * try {
 *   sessions.assertMutationAllowed(request, session);
 * } catch (error) {
 *   if (error instanceof SessionSecurityError) return new Response(error.code, { status: 403 });
 *   throw error;
 * }
 * ```
 */
export class SessionSecurityError extends Error {
  /** @param code `INVALID_ORIGIN` o `INVALID_CSRF`. */
  constructor(public readonly code: "INVALID_ORIGIN" | "INVALID_CSRF") { super(code); }
}
